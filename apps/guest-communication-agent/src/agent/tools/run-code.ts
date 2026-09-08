import { tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { computeCheckAvailability } from "@/agent/tools/availability";
import { computeCurrentDate } from "@/agent/tools/current-date";
import { computeGetPricingResult } from "@/agent/tools/pricing";
import { runInSandbox, type SandboxApi } from "@/agent/tools/sandbox";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";

// Lets the model write one small program instead of calling checkAvailability
// 5+ times across separate reasoning rounds for something like "book the next
// available weekend" (MAX_AGENT_STEPS in run-agent-turn.ts is only 8). Executes in
// Vercel Sandbox, not in-process — see sandbox.ts's top comment for the
// cross-process bridging that follows from that.

const runCodeSchema = z.object({ code: z.string() });

// Mirrors sandbox.ts's SandboxResult — gives the model the real output shape.
const runCodeOutputSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown(), logs: z.array(z.string()) }),
  z.object({ ok: z.literal(false), error: z.string(), logs: z.array(z.string()) }),
]);

// sandbox.ts can't ship these closures into the remote VM directly (see its
// top comment) — getPricing's is actually invoked, in-process, to build a
// lookup table; checkAvailability's/getCurrentDate's real logic is mirrored
// inside the generated script instead, so these two mainly make this object
// the source of truth for "these tool names are exposed to runCode".
//
// LANDMINE: deliberately read-only/computational only — never add
// sendBookingLink or anything that moves real state/money here. Booking
// stays a normal, approval-gated tool call (run-agent-turn.ts's NEEDS_APPROVAL),
// never callable from inside an agent-authored sandbox program.
const sandboxApi: SandboxApi = {
  checkAvailability: (args: Parameters<typeof computeCheckAvailability>[0]) =>
    computeCheckAvailability(args),
  getPricing: (args: Parameters<typeof computeGetPricingResult>[0]) =>
    computeGetPricingResult(args),
  getCurrentDate: () => computeCurrentDate(),
};

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
