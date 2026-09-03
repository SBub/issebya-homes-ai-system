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

// The tool registry (`tools`, handed to generateText) + dispatcher
// (`runTool`, called uniformly from run-turn.ts's loop for every tool,
// gated or not). Kept together since runTool's "unknown tool name" fallback
// needs `Object.keys(tools)`.
//
// Every registered tool's own gen_ai.tool.<name> execution span is created
// inside that tool's own run<ToolName> (see run-turn.ts's RULE comment) —
// this file wraps nothing except the "unknown tool name" fallback below,
// which has no tool file of its own to own a span.

// Model-facing tool names are snake_case; the TS identifiers stay camelCase.
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

// Derived from `tools`, the real source of truth — used by run-turn.ts to
// type-check NEEDS_APPROVAL. NOT used for runTool's own `toolName` param
// below, which stays plain `string`: a model can hallucinate a name outside
// this union, and runTool's `default` case is the real runtime handling for
// that.
export type ToolName = keyof typeof tools;

// The single dispatcher every tool call goes through. For NEEDS_APPROVAL
// tools, run-turn.ts's approval switch must have already resolved
// `approved: true` before this is reached — its HitlDecision carries
// missing_info's answer as `payload`, this function's 4th param.
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
      // Some models (deepseek included) hallucinate a close-but-wrong tool
      // name despite native function-calling's constraint. A recoverable
      // error, not a throw — throwing would crash the Inngest step with no
      // reply sent; this way the model sees the error and can retry.
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
