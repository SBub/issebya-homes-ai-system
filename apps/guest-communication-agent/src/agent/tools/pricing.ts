import { tool } from "ai";
import { z } from "zod";

// Hardcoded until pricing is in DB. Flat rate, no seasonal distinction.
const NIGHTLY_PRICE_EUR = 75;

const getPricingSchema = z.object({
  room: z.enum(["room1", "room2"]).describe("Which room"),
});

// Schema-only declaration — no `execute`. Dispatch is manual: run-turn.ts's
// own tool-call step looks up runGetPricing below by tool name and calls it
// directly, rather than delegating to AI SDK's internal per-tool execution
// (see run-turn.ts's own comments on why). No per-turn context needed, so
// (unlike sendBookingLink/escalateToOwner) this stays a single module-level
// instance reused across turns.
export const getPricing = tool({
  description: "Get the nightly price for a room. Use when the guest asks about price or cost.",
  inputSchema: getPricingSchema,
});

// The real implementation, called by run-turn.ts's dispatcher with this
// tool call's already-validated input.
export async function runGetPricing(args: z.infer<typeof getPricingSchema>) {
  const { room } = args;
  return {
    room,
    pricePerNight: NIGHTLY_PRICE_EUR,
    currency: "EUR",
    note: "Flat rate per night, does not include the tourist tax.",
  };
}
