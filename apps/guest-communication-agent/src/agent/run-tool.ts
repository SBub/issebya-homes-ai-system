import type { ToolSet } from "ai";
import { dispatchToolExecution } from "@/agent/tool-execution";
import type { HitlDecision } from "@/agent/tools/approval-gate";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import { runSendBookingLink, sendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { getCurrentDate, runGetCurrentDate } from "@/agent/tools/current-date";
import { missingInfo, runMissingInfo } from "@/agent/tools/missing-info";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";
import { runCode, runRunCode } from "@/agent/tools/run-code";
import { runWantsHuman, wantsHuman } from "@/agent/tools/wants-human";
import { steppedSpan } from "@/lib/tracing";

// The tool registry + dispatcher: which tools the model can call (`tools`,
// handed to generateText by run-model.ts's runModel), and how each one
// actually runs (`runTool`, called uniformly from run-turn.ts's dispatch
// loop for every tool, gated or not — see run-turn.ts for the approval half
// NEEDS_APPROVAL's two go through first). Kept together in one file:
// runTool's own "unknown tool name" fallback needs `Object.keys(tools)`, so
// splitting the two apart would gain nothing.
//
// Every registered tool's own gen_ai.tool.<name> execution span is created
// by that tool's own run<ToolName>, inside its own file (see
// tool-execution.ts's dispatchToolExecution, the shared helper each of them
// calls) — this file does no span-wrapping of its own except for the
// "unknown tool name" fallback below, which has no tool file of its own to
// own that span.

// Schema-only tool declarations — dispatch happens manually in runTool()
// below. Every key here is the literal snake_case tool name the model sees
// via native tool-calling — the TS identifiers on the right (sendBookingLink,
// wantsHuman, etc.) stay camelCase; only the model-facing string names are
// snake_case.
export const tools = {
  get_pricing: getPricing,
  check_availability: checkAvailability,
  answer_property_question: answerPropertyQuestion,
  send_booking_link: sendBookingLink,
  get_current_date: getCurrentDate,
  run_code: runCode,
  wants_human: wantsHuman,
  missing_info: missingInfo,
} satisfies ToolSet;

// Dispatches a requested tool call to its run<ToolName> implementation —
// the single dispatcher every tool call in this app goes through, whether
// gated or not (run-turn.ts's loop calls this uniformly; for NEEDS_APPROVAL
// tools, run-turn.ts's own inline approval switch must already have resolved
// `approved: true` before this is ever reached — its HitlDecision carries the
// owner's real answer for missing_info as `payload`, passed through as this
// function's own 4th param; send_booking_link/missing_info's run<ToolName>
// no longer need a pre-created span id from it — see each's own comment for
// why they create their own fresh execution span instead now). Every case
// just hands off to that tool's own run<ToolName>, including any span/step
// wrapping that call needs — none of that logic lives here.
export async function runTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
  approvalDecision?: HitlDecision<unknown>,
): Promise<unknown> {
  switch (toolName) {
    case "get_pricing":
      return runGetPricing(input as Parameters<typeof runGetPricing>[0], context);
    case "check_availability":
      return runCheckAvailability(input as Parameters<typeof runCheckAvailability>[0], context);
    case "answer_property_question":
      return runAnswerPropertyQuestion(
        input as Parameters<typeof runAnswerPropertyQuestion>[0],
        context,
      );
    case "send_booking_link":
      return runSendBookingLink(input as Parameters<typeof runSendBookingLink>[0], context);
    case "get_current_date":
      return runGetCurrentDate(context);
    case "run_code":
      return runRunCode(input as Parameters<typeof runRunCode>[0], context);
    case "wants_human":
      return runWantsHuman(input as { reason: string }, context);
    case "missing_info":
      return runMissingInfo(
        input as { reason: string },
        context,
        approvalDecision!.payload as string,
      );
    default:
      // Native function-calling is supposed to constrain the model to exact
      // registered tool names, but some models (deepseek included) have been
      // observed hallucinating a close-but-wrong name (e.g. "get_current_dates"
      // for "get_current_date") anyway. Returns a recoverable error instead of
      // throwing — throwing here would crash the whole Inngest step with no
      // reply sent to the guest at all — so the model sees the error and can
      // retry with a real tool name in the same turn. Wrapped in its own
      // gen_ai.tool.<name> span (unlike every real tool above, which wraps
      // itself) since there's no tool file to own that span for a name that
      // isn't actually registered — this is the one remaining span this file
      // creates directly, same shape every other tool's own span has.
      return steppedSpan(
        context.step,
        `tool-${toolName}`,
        context.traceAnchor,
        `gen_ai.tool.${toolName}`,
        { "gen_ai.tool.name": toolName, "gen_ai.operation.name": "execute_tool" },
        (span) =>
          dispatchToolExecution(span, input, async () => ({
            error: `Unknown tool name: "${toolName}". Valid tools are: ${Object.keys(tools).join(", ")}.`,
          })),
      );
  }
}
