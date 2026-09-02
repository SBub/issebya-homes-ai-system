import { tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { computeCheckAvailability } from "@/agent/tools/availability";
import { computeCurrentDate } from "@/agent/tools/current-date";
import { computeGetPricingResult } from "@/agent/tools/pricing";
import { runInSandbox, type SandboxApi } from "@/agent/tools/sandbox";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";

// Reference pattern this is ported from: a harness that runs agent-authored
// JS in node:vm and dispatches "runCode" to `runInSandbox(code, sandboxApi)`
// (see harness/tools.ts + harness/sandbox.ts). Same shape here, except the
// execution engine underneath is Vercel Sandbox, not node:vm — see
// sandbox.ts's top-of-file comment for the cross-process bridging tradeoffs
// that follow from that swap.
//
// Motivating case: "book the next available weekend" today makes the model
// call checkAvailability 5+ times across separate reasoning rounds
// (MAX_AGENT_STEPS in run-turn.ts is only 8) and reason over the results
// itself — burning tool calls and producing non-deterministic results.
// runCode lets it write one small program that loops over dates and
// computes the answer deterministically inside the sandbox instead.

const runCodeSchema = z.object({ code: z.string() });

// Mirrors sandbox.ts's SandboxResult exactly — gives the model (and anything
// typing off this tool) the real output shape instead of only a prose
// description of it.
const runCodeOutputSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown(), logs: z.array(z.string()) }),
  z.object({ ok: z.literal(false), error: z.string(), logs: z.array(z.string()) }),
]);

// Real closures, called in THIS process — exactly the reference's
// `sandboxApi` object. sandbox.ts's Vercel Sandbox implementation can't ship
// these closures into the remote VM directly (see its top-of-file comment);
// it uses them differently depending on the tool (getPricing's is actually
// invoked, in-process, to build a lookup table embedded in the sandbox
// script; checkAvailability's/getCurrentDate's real logic is instead
// mirrored directly inside the generated sandbox script, so those two
// closures here mainly make this object the single source of truth for
// "these tool names are exposed to runCode", letting runInSandbox assert
// against its SUPPORTED_TOOLS list). Calls each tool's own untraced pure
// compute function (compute*, not run<ToolName>) — this is an internal
// helper invocation, not a real dispatched tool call worth its own trace
// span, and there's no ToolContext available here to give one anyway.
//
// Deliberately read-only/computational only: NEVER add sendBookingLink or
// anything that moves real state/money here. Booking stays a normal,
// approval-gated tool call (see run-hitl.ts's NEEDS_APPROVAL), never
// something callable from inside an agent-authored sandbox program.
const sandboxApi: SandboxApi = {
  checkAvailability: (args: Parameters<typeof computeCheckAvailability>[0]) =>
    computeCheckAvailability(args),
  getPricing: (args: Parameters<typeof computeGetPricingResult>[0]) =>
    computeGetPricingResult(args),
  getCurrentDate: () => computeCurrentDate(),
};

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runRunCode below by name, same pattern as every other tool here (see
// availability.ts).
export const runCode = tool({
  description: [
    "Run a short JavaScript program (an async function body) in a real sandboxed environment, instead of making many individual tool calls.",
    "Use this when you'd otherwise need to call checkAvailability (or getPricing) repeatedly and reason over the results yourself — e.g. 'book the next available weekend': write one program that loops over candidate dates and computes the answer, rather than calling checkAvailability 5+ times across separate turns.",
    "Available inside the program:",
    "  • await tools.checkAvailability({ room, checkIn, checkOut }) → { available, room, checkIn, checkOut }",
    "  • await tools.getPricing({ room }) → { room, pricePerNight, currency, note }",
    "  • await tools.getCurrentDate() → { date, dayOfWeek, isoTimestamp, timezone } — today's real-world date; call this before doing any relative-date arithmetic",
    "  • console.log(...) for debugging — captured and returned in `logs`",
    "Use `return` to return your result (any JSON-serializable value).",
    "This does NOT have access to sendBookingLink or any tool that moves real state/money — those must still be called normally, after the guest/owner has approved.",
  ].join("\n"),
  inputSchema: runCodeSchema,
  outputSchema: runCodeOutputSchema,
});

// The tool's real dispatch: this app's run<ToolName> convention (see
// wants-human.ts's runWantsHuman for the model this follows) — creates its
// own gen_ai.tool.run_code execution span, called directly from
// run-tool.ts's runTool().
export async function runRunCode(args: z.infer<typeof runCodeSchema>, context: ToolContext) {
  return steppedSpan(
    context.step,
    "tool-run_code",
    context.traceAnchor,
    "gen_ai.tool.run_code",
    { "gen_ai.tool.name": "run_code", "gen_ai.operation.name": "execute_tool" },
    (span) => dispatchToolExecution(span, args, () => runInSandbox(args.code, sandboxApi)),
  );
}
