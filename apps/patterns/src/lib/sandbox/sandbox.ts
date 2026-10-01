import vm from "node:vm";
import { BOOKED, type CheckDatesInput } from "@/lib/tool-files/check-dates";
import type { LookupRateInput } from "@/lib/tool-files/lookup-rate";
import type { SandboxResult, ScriptRun } from "./types";

/**
 * The execution engine behind the `sandboxed-tool-shims` demo. It keeps
 * the rules of the production engine, which runs the script on a separate
 * machine, and stands in for that machine with `node:vm`:
 *
 * - The program runs inside a generated script with a wall-clock timeout
 *   and a stop in `finally`, so nothing the program does afterwards is
 *   heard, on every path.
 * - The script's result leaves on one stdout line that starts with a
 *   sentinel. Everything else on stdout is logs, and the parser reads the
 *   last sentinel line from the end.
 * - The sandbox cannot call back into this process. Each tool it may use is
 *   a shim generated into the script from an explicit allowlist: a
 *   precomputed table for a pure lookup, the real guard mirrored over a
 *   literal for a read. A tool with no shim throws before the VM starts,
 *   which is how a side-effect tool stays out by construction.
 *
 * `node:vm` is not a security boundary: a program can reach the host
 * through prototype chains. Production uses a microVM for that reason.
 * This file models the contract, not the isolation.
 */

/** The tools a program may use, keyed as `tools.<name>`. Each needs a shim in `buildScript`. */
export type SandboxApi = {
  lookupRate?: (args: LookupRateInput) => unknown;
  checkDates?: (args: CheckDatesInput, today: string) => unknown;
} & Record<string, unknown>;

/** The explicit allowlist: the names `buildScript` knows how to shim. */
export const SUPPORTED_TOOLS = ["lookupRate", "checkDates"] as const;

export const RESULT_SENTINEL = "__RUNCODE_RESULT__";

const DEFAULT_TIMEOUT_MS = 1_000;

const ROOMS = ["small", "large"] as const;

/** Throws for any key the script cannot shim, before anything runs. */
export function assertSupported(api: SandboxApi): void {
  const unsupported = Object.keys(api).filter(
    (name) => !(SUPPORTED_TOOLS as readonly string[]).includes(name),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `runInSandbox: no shim for tool(s): ${unsupported.join(", ")}. Add one to SUPPORTED_TOOLS and buildScript before exposing it.`,
    );
  }
}

/**
 * The full script: a preamble of literals, a `console` that keeps logs, a
 * `tools` object with one shim per requested key, then the program as an
 * async function body, and the sentinel line at the end. Patterns in the
 * shims are spelled without backslashes: inside this untagged template a
 * `\d` would collapse to a bare `d` in the emitted script.
 */
export function buildScript(code: string, api: SandboxApi, today: string): string {
  const preamble: string[] = [`const TODAY = ${JSON.stringify(today)};`];
  const shims: string[] = [];

  if (api.lookupRate !== undefined) {
    // The real compute, called in this process once per room, embedded as a table. Not a hand copy.
    const table: Record<string, unknown> = {};
    for (const room of ROOMS) table[room] = api.lookupRate({ room });
    preamble.push(`const RATES = ${JSON.stringify(table)};`);
    shims.push(`
  async lookupRate({ room }) {
    calls.push({ tool: "lookupRate", args: { room: room } });
    const entry = RATES[room];
    if (!entry) throw new Error("lookupRate: unknown room \\"" + room + "\\"");
    return entry;
  },`);
  }

  if (api.checkDates !== undefined) {
    // The guard mirrored, over the booked ranges as a literal. Keep it in step with computeCheckDates.
    preamble.push(`const BOOKED = ${JSON.stringify(BOOKED)};`);
    shims.push(`
  async checkDates({ from, to }) {
    calls.push({ tool: "checkDates", args: { from: from, to: to } });
    if (!(from < to)) return { ok: false, reason: "invalid_range", today: TODAY };
    if (from < TODAY) return { ok: false, reason: "past_date", today: TODAY };
    const free = !BOOKED.some(function (booked) { return from < booked.to && to > booked.from; });
    return { ok: true, free: free, from: from, to: to };
  },`);
  }

  return `"use strict";
${preamble.join("\n")}

const logs = [];
const calls = [];
// Logs go to stdout as in any process, and are kept so the model gets them with the result
const console = {
  log: (...args) => {
    const line = args.map(String).join(" ");
    logs.push(line);
    stdout.write(line + "\\n");
  },
};

const tools = {
${shims.join("\n")}
};

(async () => {
  let output;
  try {
    const result = await (async () => {
${code}
    })();
    output = { ok: true, result: result, logs: logs, calls: calls };
  } catch (err) {
    output = { ok: false, error: err instanceof Error ? err.message : String(err), logs: logs, calls: calls };
  }
  stdout.write(${JSON.stringify(RESULT_SENTINEL)} + JSON.stringify(output) + "\\n");
})();
`;
}

/**
 * Runs one script in a fresh context whose only host object is a `stdout`
 * with a `write`. The VM's own `timeout` stops a synchronous loop; the
 * race stops a program that awaits forever. The stop in `finally` runs on
 * every path, so a program that wakes up later writes into nothing.
 */
export async function runScript(source: string, timeoutMs: number): Promise<ScriptRun> {
  const lines: string[] = [];
  let stopped = false;
  const context = vm.createContext({
    stdout: {
      write(text: string) {
        if (!stopped) lines.push(String(text));
      },
    },
  });
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  let error: string | null = null;
  try {
    const script = new vm.Script(source, { filename: "run-code.js" });
    const running = script.runInContext(context, { timeout: timeoutMs });
    await Promise.race([Promise.resolve(running), expired]);
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    clearTimeout(timer);
    stopped = true;
  }
  return { stdout: lines.join(""), error, stopped, elapsedMs: Date.now() - started };
}

/** The last line that starts with the sentinel, parsed. Anything else on stdout is ignored. */
export function parseSandboxOutput(stdout: string): SandboxResult | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith(RESULT_SENTINEL));
  if (line === undefined) return null;
  try {
    return JSON.parse(line.slice(RESULT_SENTINEL.length)) as SandboxResult;
  } catch {
    return null;
  }
}

export type SandboxOptions = {
  timeoutMs?: number;
  /** Today's date for the mirrored guard. Production evaluates the clock inside the VM. */
  today?: string;
  /** Sees the raw run before it is parsed, so a route can show stdout next to the result. */
  onScriptRun?: (run: ScriptRun) => void;
};

/** The tool's engine: allowlist check, script, run, parse. Throws only for a key with no shim. */
export async function runInSandbox(
  code: string,
  api: SandboxApi,
  options: SandboxOptions = {},
): Promise<SandboxResult> {
  assertSupported(api);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const run = await runScript(
    buildScript(code, api, today),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  options.onScriptRun?.(run);
  if (run.error !== null) return { ok: false, error: run.error, logs: [], calls: [] };
  const parsed = parseSandboxOutput(run.stdout);
  if (parsed === null) {
    return {
      ok: false,
      error: `sandbox produced no parsable result (stdout: ${run.stdout.slice(0, 200)})`,
      logs: [],
      calls: [],
    };
  }
  return parsed;
}
