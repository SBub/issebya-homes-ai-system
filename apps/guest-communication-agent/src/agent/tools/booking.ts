import { tool } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { withSpan } from "@/lib/tracing";
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

export async function runSendBookingLink(
  args: z.infer<typeof sendBookingLinkSchema>,
  context: ToolContext,
) {
  const { guestName, room, checkIn, checkOut } = args;
  const { conversationId, phone } = context;
  await withSpan(
    "db.insertBookingLinkRequest",
    { "db.table": "booking_link_requests", "gca.conversation_id": conversationId },
    async () => {
      const supabase = createAdminClient();
      // Previously unchecked: the insert's { error } was never read, so a
      // failed insert was fully silent — a guest could get a working booking
      // link with no booking_link_requests row behind it, and nothing would
      // ever say so. Now throws on failure so the tool call itself fails
      // instead of returning a booking link with no request recorded behind
      // it — withSpan records the exception and marks the span as ERROR
      // before rethrowing.
      const { error } = await supabase.from("booking_link_requests").insert({
        conversation_id: conversationId,
        phone_number: phone,
        guest_name: guestName,
        room,
        check_in: checkIn,
        check_out: checkOut,
      });
      if (error) {
        throw new Error(
          `Failed to record booking_link_request for conversation ${conversationId}: ${error.message}`,
        );
      }
    },
  );
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
  const url = `${siteUrl}/booking?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`;
  return { url };
}
