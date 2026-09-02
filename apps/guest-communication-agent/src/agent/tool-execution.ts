import type { Span } from "@opentelemetry/api";
import { markSpanFailed } from "@/lib/tracing";

// Shared, tool-agnostic tracing helper: every tool's own run<ToolName>
// creates its own gen_ai.tool.<name> execution span (this app's
// run<ToolName> convention — see wants-human.ts's runWantsHuman for the
// model this follows) and calls dispatchToolExecution from inside it. Lives
// here, not inside any one tool file or run-tool.ts, so every tool file can
// import it without a circular dependency (run-tool.ts already imports each
// tool's schema/run<ToolName>; a tool file importing back from run-tool.ts
// would cycle).

// Detects the soft-fail result shapes a tool can hand back to
// dispatchToolExecution below WITHOUT throwing — a real exception already
// gets recordException + ERROR status for free from withTurnSpan's own catch
// block (see tracing.ts), so this is only for the intentional "return an
// error object instead of throwing" shapes. Two known shapes flow through
// here today:
//   - run_code's SandboxResult ({ ok: false, error, logs } — see
//     sandbox.ts's runInSandbox, every one of its early-return branches uses
//     this shape).
//   - run-tool.ts's runTool own "unknown tool name" fallback, which returns
//     a bare { error: string } with no `ok` field at all.
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

// Runs `execute`, then records gca.tool.input/gca.tool.output +
// braintrust.input/braintrust.output on the span already open around this
// call (see tracing.ts's withTurnSpan doc comment for why the braintrust.*
// duplication exists) — the same 4 attributes every tool used to set by hand
// before this was centralized. Not used by wants-human.ts's runWantsHuman,
// missing-info.ts's requestMissingInfoApproval, or booking.ts's
// requestSendBookingLinkApproval: none of the three knows its tool call's
// real output at span-creation time (an approval-gated call's decision
// hasn't even been made yet), so each patches output in retroactively via
// updateSpanIO instead — see each of their own comments.
//
// Also marks the span ERROR (via markSpanFailed, same mechanism
// runGuestTurn's own send-whatsapp-reply call site already uses for
// sendWhatsAppMessage's own soft-fail shape) when `execute`'s result looks
// like an intentional soft-fail rather than a real success — see
// detectToolSoftFailure's own comment for exactly which shapes qualify.
// Purely additive: does not throw, does not change `output`, does not alter
// the caller's control flow — a soft-failed call still returns its normal
// (now span-marked) result.
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
