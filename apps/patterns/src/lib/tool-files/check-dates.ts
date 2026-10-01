import { z } from "zod";
import { steppedSpan } from "@/lib/trace-anchor/anchored-request";
import type { ToolContext } from "./context";
import { dispatchToolExecution } from "./tool-execution";

/**
 * One tool, one file: the schema the model sees, a pure compute that a unit
 * test can call with no runtime, and the traced `run<Tool>` that owns the
 * step and the span. The compute returns a soft failure as `{ ok: false }`
 * so the model can read it and correct itself.
 */

const checkDatesSchema = z.object({
  from: z.string().describe("Check-in date, YYYY-MM-DD"),
  to: z.string().describe("Check-out date, YYYY-MM-DD"),
});

/** Schema only, no `execute`: the dispatcher runs `runCheckDates` by name. */
export const checkDates = {
  description: "Whether a date range is free. Use when the person names dates.",
  inputSchema: checkDatesSchema,
};

export type CheckDatesInput = z.infer<typeof checkDatesSchema>;

export type CheckDatesResult =
  | { ok: true; free: boolean; from: string; to: string }
  | { ok: false; reason: "invalid_range" | "past_date"; today: string };

const BOOKED = [{ from: "2026-10-10", to: "2026-10-12" }];

/** Pure: no step, no span, no clock. The date comes in as an argument. */
export function computeCheckDates(args: CheckDatesInput, today: string): CheckDatesResult {
  const { from, to } = args;
  // ISO dates compare as strings.
  if (!(from < to)) return { ok: false, reason: "invalid_range", today };
  if (from < today) return { ok: false, reason: "past_date", today };
  const free = !BOOKED.some((booked) => from < booked.to && to > booked.from);
  return { ok: true, free, from, to };
}

export function runCheckDates(input: Record<string, unknown>, context: ToolContext) {
  return steppedSpan(
    context.step,
    context.tracer,
    "tool-check_dates",
    context.traceAnchor,
    (span) =>
      dispatchToolExecution(span, input, () => {
        const parsed = checkDatesSchema.safeParse(input);
        if (!parsed.success) return invalidInput("check_dates", parsed.error);
        return computeCheckDates(parsed.data, context.today);
      }),
  );
}

/** The single-key error object: a soft failure the model can read. */
export function invalidInput(toolName: string, error: z.ZodError): { error: string } {
  const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { error: `Invalid input for ${toolName}: ${issues.join("; ")}` };
}
