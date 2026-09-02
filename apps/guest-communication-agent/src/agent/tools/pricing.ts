import { tool } from "ai";
import { ROOM_PRICING } from "pricing";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";

const getPricingSchema = z.object({
  room: z.enum(["room1", "room2"]).describe("Which room"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runGetPricing below by name.
export const getPricing = tool({
  description: "Get the nightly price for a room. Use when the guest asks about price or cost.",
  inputSchema: getPricingSchema,
});

// Pure lookup, no tracing — also called directly by run-code.ts's sandboxApi
// (building a lookup table for the sandboxed script), which has no
// ToolContext and needs none: that call is an internal helper invocation,
// not a real dispatched tool call worth its own trace span.
export function computeGetPricingResult(args: z.infer<typeof getPricingSchema>) {
  const { room } = args;
  return {
    room,
    pricePerNight: ROOM_PRICING.basePrice,
    currency: ROOM_PRICING.currency,
    note: "Flat rate per night, does not include the tourist tax.",
  };
}

// The tool's real dispatch: this app's run<ToolName> convention (see
// wants-human.ts's runWantsHuman for the model this follows) — creates its
// own gen_ai.tool.get_pricing execution span, called directly from
// run-tool.ts's runTool().
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
