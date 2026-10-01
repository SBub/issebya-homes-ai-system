import { z } from "zod";
import { steppedSpan } from "@/lib/trace-anchor/anchored-request";
import { invalidInput } from "./check-dates";
import type { ToolContext } from "./context";
import { dispatchToolExecution } from "./tool-execution";

const lookupRateSchema = z.object({
  room: z.enum(["small", "large"]).describe("Which room"),
});

/** Schema only, no `execute`. */
export const lookupRate = {
  description: "The nightly rate for a room. Use when the person asks about price.",
  inputSchema: lookupRateSchema,
};

export type LookupRateInput = z.infer<typeof lookupRateSchema>;

/** Pure lookup. */
export function computeLookupRate(args: LookupRateInput) {
  const { room } = args;
  return { room, nightly: room === "small" ? 95 : 140, currency: "EUR" };
}

export function runLookupRate(input: Record<string, unknown>, context: ToolContext) {
  return steppedSpan(
    context.step,
    context.tracer,
    "tool-lookup_rate",
    context.traceAnchor,
    (span) =>
      dispatchToolExecution(span, input, () => {
        const parsed = lookupRateSchema.safeParse(input);
        if (!parsed.success) return invalidInput("lookup_rate", parsed.error);
        return computeLookupRate(parsed.data);
      }),
  );
}
