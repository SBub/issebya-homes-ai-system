import type { Span } from "@opentelemetry/api";
import type { ToolSet } from "ai";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import { runSendBookingLink, sendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { getCurrentDate, runGetCurrentDate } from "@/agent/tools/current-date";
import { missingInfo, runMissingInfo } from "@/agent/tools/missing-info";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";
import { runCode, runRunCode } from "@/agent/tools/run-code";
import { runWantsHuman, wantsHuman } from "@/agent/tools/wants-human";
import { markSpanFailed } from "@/lib/tracing";

// The tool registry + dispatcher: which tools the model can call (`tools`,
// handed to generateText by run-turn.ts's modelTurn), and how each one
// actually runs (`runTool`, dispatched from run-turn.ts's tool-call loop —
// directly for wants_human/missing_info, after an APPROVAL_GATES check for
// send_booking_link, or wrapped in dispatchToolExecution's tracing for every
// other tool). Kept together in one file rather than split across
// run-turn.ts/here: runTool's own "unknown tool name" fallback needs
// `Object.keys(tools)`, so splitting them would mean a circular import
// between this file and run-turn.ts.

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

// Detects the soft-fail result shapes a tool can hand back to
// dispatchToolExecution below WITHOUT throwing — a real exception already
// gets recordException + ERROR status for free from withTurnSpan's own catch
// block (see tracing.ts), so this is only for the intentional "return an
// error object instead of throwing" shapes. Two known shapes flow through
// here today:
//   - run_code's SandboxResult ({ ok: false, error, logs } — see
//     sandbox.ts's runInSandbox, every one of its early-return branches uses
//     this shape).
//   - runTool's own "unknown tool name" fallback (its switch's default
//     case, below), which returns a bare { error: string } with no `ok`
//     field at all.
// Deliberately narrow, not "does this object have an `error` key anywhere":
// several tools return a plain, successful object that happens to contain an
// `error`-named field as part of normal (non-exceptional) data — e.g.
// checkAvailability's { available: false, error: "Invalid date format" } for
// a malformed date range, which is a valid tool result, not a dispatch
// failure. Only `ok === false` explicitly, or the fallback's exact
// single-key `{ error: string }` shape, count as a soft-fail here — anything
// else (a plain string, a plain object with other fields, `ok: true`, no
// `ok`/`error` fields at all) is left alone and never marked failed.
function detectToolSoftFailure(output: unknown): string | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }
  const record = output as Record<string, unknown>;
  if (record.ok === false) {
    return typeof record.error === "string" ? record.error : "tool call failed";
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "error" && typeof record.error === "string") {
    return record.error;
  }
  return null;
}

// Shared by every non-gated, non-self-stepped tool's execution span (see
// run-turn.ts's runAgentTurn loop, dispatchGenericTool). Runs `execute`, then
// records gca.tool.input/gca.tool.output + braintrust.input/braintrust.output
// on the steppedSpan already open around this call (see tracing.ts's
// withTurnSpan doc comment for why the braintrust.* duplication exists) — the
// same 4 attributes every one of these call sites used to set by hand. Not
// used by wants-human.ts's runWantsHuman, missing-info.ts's runMissingInfo,
// or run-turn.ts's own private dispatchGatedToolCall: none of the three
// knows its tool call's real output at span-creation time (a gated call's
// approval hasn't even been decided yet), so each patches output in
// retroactively via updateSpanIO instead — see each of their own comments.
//
// Also marks the span ERROR (via markSpanFailed, same mechanism
// runGuestTurn's own send-whatsapp-reply call site already uses for
// sendWhatsAppMessage's own soft-fail shape) when `execute`'s result looks
// like an intentional soft-fail rather than a real success — see
// detectToolSoftFailure's own comment for exactly which shapes qualify. This
// is the one choke point every non-self-stepped tool call (including the
// "unknown tool name" fallback, which reaches here the same way any other
// unrecognized-but-not-gated tool name would — see runTool's default case
// below) dispatches through, so putting the check here covers all of them
// without touching each tool's own file. Purely additive: does not throw,
// does not change `output`, does not alter the caller's control flow — a
// soft-failed call still returns its normal (now span-marked) result.
export async function dispatchToolExecution<T>(
  span: Span,
  input: Record<string, unknown>,
  execute: () => Promise<T>,
): Promise<T> {
  const output = await execute();
  span.setAttribute("gca.tool.input", JSON.stringify(input));
  span.setAttribute("gca.tool.output", JSON.stringify(output));
  span.setAttribute("braintrust.input", JSON.stringify(input));
  span.setAttribute("braintrust.output", JSON.stringify(output));
  const failureMessage = detectToolSoftFailure(output);
  if (failureMessage !== null) {
    markSpanFailed(span, failureMessage);
  }
  return output;
}

// Dispatches a requested tool call to its run<ToolName> implementation.
// Called after any configured APPROVAL_GATES check (run-turn.ts) has already
// approved the call, never before it.
export async function runTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<unknown> {
  switch (toolName) {
    case "get_pricing":
      return runGetPricing(input as Parameters<typeof runGetPricing>[0]);
    case "check_availability":
      return runCheckAvailability(input as Parameters<typeof runCheckAvailability>[0]);
    case "answer_property_question":
      return runAnswerPropertyQuestion(input as Parameters<typeof runAnswerPropertyQuestion>[0]);
    case "send_booking_link":
      return runSendBookingLink(input as Parameters<typeof runSendBookingLink>[0], {
        phone: context.phone,
      });
    case "get_current_date":
      return runGetCurrentDate();
    case "run_code":
      return runRunCode(input as Parameters<typeof runRunCode>[0]);
    case "wants_human":
      return runWantsHuman(input as { reason: string }, context);
    case "missing_info":
      return runMissingInfo(input as { reason: string }, context);
    default:
      // Native function-calling is supposed to constrain the model to exact
      // registered tool names, but some models (deepseek included) have been
      // observed hallucinating a close-but-wrong name (e.g. "get_current_dates"
      // for "get_current_date") anyway. Returns a recoverable error instead of
      // throwing — throwing here would crash the whole Inngest step with no
      // reply sent to the guest at all — so the model sees the error and can
      // retry with a real tool name in the same turn.
      return {
        error: `Unknown tool name: "${toolName}". Valid tools are: ${Object.keys(tools).join(", ")}.`,
      };
  }
}
