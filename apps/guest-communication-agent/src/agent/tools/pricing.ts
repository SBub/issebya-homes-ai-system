import { tool } from "ai";
import { ROOM_PRICING } from "pricing";
import { z } from "zod";

const getPricingSchema = z.object({
  room: z.enum(["room1", "room2"]).describe("Which room"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runGetPricing below by name.
export const getPricing = tool({
  description: "Get the nightly price for a room. Use when the guest asks about price or cost.",
  inputSchema: getPricingSchema,
});

export async function runGetPricing(args: z.infer<typeof getPricingSchema>) {
  const { room } = args;
  return {
    room,
    pricePerNight: ROOM_PRICING.basePrice,
    currency: ROOM_PRICING.currency,
    note: "Flat rate per night, does not include the tourist tax.",
  };
}
