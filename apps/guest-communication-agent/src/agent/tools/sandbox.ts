import { Sandbox } from "@vercel/sandbox";

// Vercel-Sandbox-backed implementation of the runCode tool's execution
// engine. Ported from a reference harness's node:vm-based sandbox.ts (see
// run-code.ts's top-of-file comment for the reference), keeping the exact
// same SandboxResult/SandboxApi contract and {ok, result, logs} shape — only
// the execution engine changes.
//
// ## The cross-process bridging problem
//
// node:vm can hand real JS closures straight into the sandboxed context
// because it runs inside THIS process's own memory (see
// vm.createContext({ tools: api, ... }) in the reference). Vercel Sandbox is
// a genuinely separate remote machine (a Firecracker microVM) — code running
// inside it cannot call back into a closure living in this Node process, and
// there is no tunnel wired up here that would let the sandbox reach back
// into this machine's localhost (that only becomes possible once this app
// itself is deployed with a public URL a callback route could live on —
// option (a), a real HTTP callback endpoint, e.g. reusing this app's own
// Next.js route surface).
//
// Both of the tools actually exposed to runCode below happen to need no
// such callback (option (b) instead):
//   - checkAvailability's real implementation (runCheckAvailability in
//     availability.ts) is ITSELF just `fetch(${SITE_URL}/api/availability)`
//     plus a pure in-memory date-overlap check — no DB, no secrets, nothing
//     that only exists in this process's memory. The generated sandbox
//     script below re-issues that exact same fetch against the exact same
//     public endpoint and mirrors the same overlap check, so code running
//     remotely gets live, real data without any callback plumbing.
//   - getPricing's real implementation (runGetPricing in pricing.ts) does
//     NO I/O at all — it returns a hardcoded constant. Rather than
//     hand-copying that constant here (drift risk), this module calls the
//     real `api.getPricing` closure once per room, IN THIS PROCESS, before
//     the sandbox starts, and embeds the actual current result as a small
//     lookup table in the generated script.
//   - getCurrentDate has no args and no I/O either — its logic (today's
//     date in UTC) is mirrored directly, evaluated at the moment the
//     sandbox actually runs the agent's code rather than precomputed here,
//     so it stays accurate even if sandbox provisioning takes a few
//     seconds.
//
// If a future tool needs real per-call access to this process's private
// state (a DB query, a secret), it will need real option (a) callback
// plumbing — a public API route on this app's already-public Next.js
// surface that the sandbox fetches — since Vercel Sandbox has no way to
// call back into an arbitrary local process. SUPPORTED_TOOLS below is the
// explicit list of tool names this module knows how to bridge; run-code.ts
// asserts its SandboxApi only ever contains a subset of it.

export type SandboxResult =
  | { ok: true; result: unknown; logs: string[] }
  | { ok: false; error: string; logs: string[] };

// Matches the reference harness's SandboxApi shape exactly — a generic
// "callable tool" bag whose members each have their own real, specific arg
// types at the call site (see run-code.ts's sandboxApi), so a narrower
// shared signature isn't possible.
// biome-ignore lint/suspicious/noExplicitAny: see comment above.
export type SandboxApi = Record<string, (...args: any[]) => unknown>;

// Rooms this property has. Duplicated from the z.enum(["room1", "room2"])
// literals in availability.ts/pricing.ts/booking.ts — there's no shared
// constant for this anywhere in the codebase yet (checked: none exists), so
// this follows the same per-file duplication those already do rather than
// inventing a new shared module for it. Only used to precompute getPricing's
// tiny, fully enumerable result table below.
const ROOMS = ["room1", "room2"] as const;

// Tool names this module knows how to bridge into a remote sandbox script.
// run-code.ts's SandboxApi must only ever contain a subset of these — see
// the assertion in runInSandbox below.
const SUPPORTED_TOOLS = ["checkAvailability", "getPricing", "getCurrentDate"] as const;

// Sandbox provisioning (spinning up a real Firecracker VM) alone can take a
// few seconds on top of the actual execution time, so this is generous
// compared to the reference's 2000ms node:vm default — that default assumed
// near-zero-latency in-process execution, which no longer holds here.
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
    // Always tear the sandbox down so runs don't leak — an unstopped
    // sandbox keeps consuming a slot until its own timeout eventually fires
    // on its own.
    try {
      await sandbox.stop();
    } catch (stopErr) {
      console.error("[sandbox] failed to stop sandbox after runCode:", stopErr);
    }
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

// Builds the full Node script that actually runs inside the remote sandbox:
// a `tools` object with one hand-written shim per requested SandboxApi key
// (see this file's top-of-file comment for why these are hand-written
// mirrors, not the real closures), followed by the agent-authored `code` as
// an async function body — same wrapping shape as the node:vm reference
// (`(async () => { ${code} })()`), just written to a file and executed with
// a real `node` process instead of vm.runInContext.
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
