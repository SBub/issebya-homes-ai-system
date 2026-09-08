import type { Span } from "@opentelemetry/api";
import { markSpanFailed } from "@/lib/tracing";

// Shared tracing helper every tool's run<ToolName> calls from inside its own
// gen_ai.tool.<name> span. Lives here (not in any one tool file or
// run-tool.ts) so every tool file can import it without a circular
// dependency (run-tool.ts already imports each tool's run<ToolName>).

// Deliberately narrow — only `ok === false`, or the exact single-key
// `{ error: string }` shape (run-tool.ts's "unknown tool name" fallback) —
// not "does this object have an error key anywhere". Several tools return a
// plain successful object that happens to have an `error`-named field as
// normal data (e.g. checkAvailability's `{ available: false, error: "..." }`
// for a malformed date), which must not be marked failed.
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

// Runs `execute`, records gca.tool.*/braintrust.* input+output on the
// already-open span, and marks it ERROR (via markSpanFailed, without
// throwing) if the result looks like an intentional soft-fail — see
// detectToolSoftFailure above. Not used by the gated/multi-step tools
// (wants_human, missing_info, send_booking_link): none of them knows its
// real output at span-creation time, so each patches it in via updateSpanIO
// instead.
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
