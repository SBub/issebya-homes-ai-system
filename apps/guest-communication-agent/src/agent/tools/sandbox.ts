import * as Sentry from "@sentry/nextjs";
import { Sandbox } from "@vercel/sandbox";
import { markSpanFailed, withSpan } from "@/lib/tracing";

// Vercel-Sandbox-backed execution engine for the runCode tool.
//
// LANDMINE — cross-process bridging: Vercel Sandbox is a genuinely separate
// remote machine (a Firecracker microVM), so code running inside it cannot
// call back into a closure living in this Node process — there's no tunnel
// for that (it would require a real HTTP callback route on this app's own
// public surface, which doesn't exist yet). The 3 tools bridged below avoid
// needing one:
//   - checkAvailability: its real implementation is itself just a public
//     fetch + a pure date-overlap check, so the generated script re-issues
//     that same fetch directly — no callback needed.
//   - getPricing: no I/O, a hardcoded constant. Rather than hand-copying it
//     (drift risk), this module calls the real closure once per room, in
//     this process, before the sandbox starts, and embeds the result as a
//     lookup table in the generated script.
//   - getCurrentDate: no I/O either — its logic is mirrored directly,
//     evaluated when the sandbox actually runs (not precomputed), so it
//     stays accurate even if provisioning takes a few seconds.
//
// A future tool needing real per-call access to this process's private
// state (a DB query, a secret) would need a real callback route — Vercel
// Sandbox has no way to call back into an arbitrary local process.
// SUPPORTED_TOOLS below is the explicit list this module knows how to
// bridge; run-code.ts's SandboxApi must only ever be a subset of it.

export type SandboxResult =
  { ok: true; result: unknown; logs: string[] } | { ok: false; error: string; logs: string[] };

// A generic "callable tool" bag — each member has its own real arg types at
// the call site (run-code.ts's sandboxApi), so a narrower shared signature
// isn't possible.
// biome-ignore lint/suspicious/noExplicitAny: see comment above.
export type SandboxApi = Record<string, (...args: any[]) => unknown>;

// Duplicated from the z.enum(["room1", "room2"]) literals elsewhere — no
// shared constant exists yet. Only used to precompute getPricing's table.
const ROOMS = ["room1", "room2"] as const;

const SUPPORTED_TOOLS = ["checkAvailability", "getPricing", "getCurrentDate"] as const;

// Sandbox provisioning (a real Firecracker VM) alone can take a few seconds
// on top of execution time, hence the generous default.
const DEFAULT_TIMEOUT_MS = 30_000;
// The sandbox's own max lifetime needs headroom beyond the command's
// timeoutMs (execution budget) below, or the VM's own timeout could kill it
// mid-provisioning before our command-level timeout even gets a chance to
// run and report a clean "timed out" error.
const SANDBOX_LIFETIME_BUFFER_MS = 30_000;

const RESULT_SENTINEL = "__RUNCODE_RESULT__";

export async function runInSandbox(
  code: string,
  api: SandboxApi,
  opts: { timeoutMs?: number } = {},
): Promise<SandboxResult> {
  const unsupported = Object.keys(api).filter(
    (name) => !(SUPPORTED_TOOLS as readonly string[]).includes(name),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `runInSandbox (Vercel Sandbox engine): no remote shim implemented for tool(s): ${unsupported.join(", ")}. ` +
        `Add one to sandbox.ts's SUPPORTED_TOOLS/buildScript before exposing it via SandboxApi.`,
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const script = await buildScript(code, api);

  const sandbox = await Sandbox.create({
    timeout: timeoutMs + SANDBOX_LIFETIME_BUFFER_MS,
  });

  try {
    await sandbox.writeFiles([{ path: "run-code.js", content: Buffer.from(script, "utf8") }]);

    const cmd = await sandbox.runCommand({
      cmd: "node",
      args: ["run-code.js"],
      timeoutMs,
    });

    if (cmd.exitCode !== 0) {
      const stderr = (await cmd.stderr()).trim();
      return {
        ok: false,
        error: stderr || `sandbox process exited with code ${cmd.exitCode}`,
        logs: [],
      };
    }

    const stdout = await cmd.stdout();
    const parsed = parseSandboxOutput(stdout);
    if (!parsed) {
      return {
        ok: false,
        error: `sandbox produced no parsable result (stdout: ${stdout.slice(0, 500)})`,
        logs: [],
      };
    }
    return parsed;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      logs: [],
    };
  } finally {
    // Always tear the sandbox down so runs don't leak (an unstopped sandbox
    // keeps consuming a slot until its own timeout fires). By this point the
    // guest already has their result, so a stop() failure stays
    // fire-and-forget — the span just makes it visible on the trace instead
    // of only in logs.
    await withSpan("sandbox.stop", {}, async (span) => {
      try {
        await sandbox.stop();
      } catch (stopErr) {
        console.error("[sandbox] failed to stop sandbox after runCode:", stopErr);
        markSpanFailed(span, stopErr);
        Sentry.captureException(stopErr);
      }
    });
  }
}

function parseSandboxOutput(stdout: string): SandboxResult | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(RESULT_SENTINEL));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(RESULT_SENTINEL.length)) as SandboxResult;
  } catch {
    return null;
  }
}

// Builds the full Node script that runs inside the remote sandbox: a
// `tools` object with one hand-written shim per requested SandboxApi key
// (see this file's top comment for why these are mirrors, not real
// closures), followed by the agent-authored `code` as an async function
// body.
async function buildScript(code: string, api: SandboxApi): Promise<string> {
  const requested = new Set(Object.keys(api));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";

  const preambleParts: string[] = [];
  const toolMethods: string[] = [];

  if (requested.has("checkAvailability")) {
    preambleParts.push(`const SITE_URL = ${JSON.stringify(siteUrl)};`);
    toolMethods.push(`
  async checkAvailability({ room, checkIn, checkOut }) {
    const reqStart = new Date(checkIn);
    const reqEnd = new Date(checkOut);
    if (Number.isNaN(reqStart.getTime()) || Number.isNaN(reqEnd.getTime())) {
      return { available: false, error: "Invalid date format" };
    }
    const res = await fetch(SITE_URL + "/api/availability?room=" + room);
    if (!res.ok) {
      throw new Error("GET /api/availability?room=" + room + " failed with status " + res.status);
    }
    const { bookings } = await res.json();
    const conflict = bookings.find(function (b) {
      const bookedStart = new Date(b.start);
      const bookedEnd = new Date(b.end);
      return reqStart < bookedEnd && reqEnd > bookedStart;
    });
    return { available: !conflict, room: room, checkIn: checkIn, checkOut: checkOut };
  },`);
  }

  if (requested.has("getPricing")) {
    // Real call into the real closure, in this process, once per room —
    // not a hand-copied constant. See top-of-file comment.
    const pricingTable: Record<string, unknown> = {};
    for (const room of ROOMS) {
      pricingTable[room] = await Promise.resolve(api.getPricing({ room }));
    }
    preambleParts.push(`const PRICING_TABLE = ${JSON.stringify(pricingTable)};`);
    toolMethods.push(`
  async getPricing({ room }) {
    const entry = PRICING_TABLE[room];
    if (!entry) {
      throw new Error("getPricing: unknown room \\"" + room + "\\"");
    }
    return entry;
  },`);
  }

  if (requested.has("getCurrentDate")) {
    toolMethods.push(`
  async getCurrentDate() {
    const now = new Date();
    return {
      date: now.toISOString().slice(0, 10),
      dayOfWeek: now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      isoTimestamp: now.toISOString(),
      timezone: "UTC",
    };
  },`);
  }

  return `"use strict";
${preambleParts.join("\n")}

const logs = [];
const console = { log: (...args) => logs.push(args.map(String).join(" ")) };

const tools = {
${toolMethods.join("\n")}
};

(async () => {
  let output;
  try {
    const result = await (async () => {
${code}
    })();
    output = { ok: true, result, logs };
  } catch (err) {
    output = { ok: false, error: err instanceof Error ? err.message : String(err), logs };
  }
  process.stdout.write(${JSON.stringify(RESULT_SENTINEL)} + JSON.stringify(output) + "\\n");
})();
`;
}
