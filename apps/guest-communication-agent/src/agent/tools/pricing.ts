import { tool } from "ai";
import { ROOM_PRICING } from "pricing";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";

const getPricingSchema = z.object({
  room: z.enum(["room1", "room2"]).describe("Which room"),
});

// Schema-only — run-tool.ts dispatches to runGetPricing below by name.
export const getPricing = tool({
  description: "Get the nightly price for a room. Use when the guest asks about price or cost.",
  inputSchema: getPricingSchema,
});

// Pure lookup, no tracing — also called directly by run-code.ts's sandboxApi
// as an internal helper, not a dispatched tool call worth its own span.
export function computeGetPricingResult(args: z.infer<typeof getPricingSchema>) {
  const { room } = args;
  return {
    room,
    pricePerNight: ROOM_PRICING.basePrice,
    currency: ROOM_PRICING.currency,
    note: "Flat rate per night, does not include the tourist tax.",
  };
}

export async function runGetPricing(args: z.infer<typeof getPricingSchema>, context: ToolContext) {
  return steppedSpan(
    context.step,
    "tool-get_pricing",
    context.traceAnchor,
    "gen_ai.tool.get_pricing",
    { "gen_ai.tool.name": "get_pricing", "gen_ai.operation.name": "execute_tool" },
    (span) => dispatchToolExecution(span, args, async () => computeGetPricingResult(args)),
  );
}
