import { tool } from "ai";
import { z } from "zod";

// Hardcoded until pricing is in DB. Flat rate, no seasonal distinction.
const NIGHTLY_PRICE_EUR = 75;

// No per-turn context needed, so (unlike sendBookingLink/escalateToOwner)
// this stays a single module-level instance reused across turns — see
// run-turn.ts's buildAgentTools for why that's safe even though the tools
// object as a whole is still assembled fresh every runAgentTurn() call.
export const getPricing = tool({
  description: "Get the nightly price for a room. Use when the guest asks about price or cost.",
  inputSchema: z.object({
    room: z.enum(["room1", "room2"]).describe("Which room"),
  }),
  execute: async ({ room }) => {
    return {
      room,
      pricePerNight: NIGHTLY_PRICE_EUR,
      currency: "EUR",
      note: "Flat rate per night, does not include the tourist tax.",
    };
  },
});
