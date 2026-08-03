import { tool } from "ai";
import { z } from "zod";

// Hardcoded until pricing is in DB. Flat rate, no seasonal distinction.
const NIGHTLY_PRICE_EUR = 75;

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
    pricePerNight: NIGHTLY_PRICE_EUR,
    currency: "EUR",
    note: "Flat rate per night, does not include the tourist tax.",
  };
}
