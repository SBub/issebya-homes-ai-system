import type { Span } from "@/lib/harness/span-exporter";

/**
 * The one helper every plain tool's `run<Tool>` calls from inside its own
 * span: run the compute, record input and output on the span, and mark the
 * span failed, without throwing, when the output is a soft failure the model
 * is meant to read and recover from.
 */

/**
 * Deliberately narrow: `ok === false`, or the single-key `{ error: string }`
 * shape the dispatcher returns for an unknown tool name. A successful object
 * that happens to carry an `error` field among other keys is normal data and
 * must not be marked failed.
 */
export function detectSoftFailure(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  const record = output as Record<string, unknown>;
  if (record.ok === false) {
    if (typeof record.reason === "string") return record.reason;
    if (typeof record.error === "string") return record.error;
    return "tool call failed";
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "error" && typeof record.error === "string") {
    return record.error;
  }
  return null;
}

export async function dispatchToolExecution<T>(
  span: Span,
  input: Record<string, unknown>,
  execute: () => T | Promise<T>,
): Promise<T> {
  const output = await execute();
  span.setAttribute("tool.input", JSON.stringify(input));
  span.setAttribute("tool.output", JSON.stringify(output));
  const failure = detectSoftFailure(output);
  if (failure !== null) span.fail(failure);
  return output;
}
