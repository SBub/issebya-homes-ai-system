import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./config";

// TODO: this trusts the model already called checkAvailability and got
// "available" — it does not independently re-verify before creating the
// link. The model can confidently answer an availability question without
// ever calling checkAvailability, so this could send a link for a room
// that's actually taken. Should defensively re-check against
// GET /api/availability?room= and return a structured error if unavailable.

const sendBookingLinkSchema = z.object({
  guestName: z.string().describe("Guest full name"),
  room: z.enum(["room1", "room2"]).describe("Room they want to book"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runSendBookingLink below by name, passing this turn's ToolContext.
export const sendBookingLink = tool({
  description:
    "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name first if not known.",
  inputSchema: sendBookingLinkSchema,
});

// Stub: just builds the link, no DB write. There's no booking_link_requests
// table anymore — real booking-request tracking will be gated on actual
// payment instead, not on this tool being called.
export async function runSendBookingLink(
  args: z.infer<typeof sendBookingLinkSchema>,
  _context: ToolContext,
) {
  const { room, checkIn, checkOut } = args;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
  const url = `${siteUrl}/booking?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`;
  return { url };
}
