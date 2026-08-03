import { tool } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import type { ToolContext } from "./config";

// TODO(agent-migration): this trusts the model already called
// checkAvailability and got a real "available" result — it does not
// independently re-verify availability before creating the link. An
// experiment showed the model can answer an availability question
// confidently without calling checkAvailability at all, so it could
// plausibly call sendBookingLink for a room that's actually unavailable.
// Add a defensive re-check against the same GET /api/availability?room=
// endpoint, and if unavailable return a structured error (e.g.
// { error: 'not_available', room, checkIn, checkOut }) so the model can tell
// the guest and suggest alternative dates instead of silently sending a link
// for a room that's actually taken.
//
// A factory rather than a single module-level instance (unlike
// pricing.ts/availability.ts) because this tool needs conversationId/phone
// to attribute the booking_link_requests insert to the right guest —
// run-turn.ts's buildAgentTools calls this fresh every turn, closing over
// that turn's context instead of threading it through per-call config the
// way LangChain's RunnableConfig.configurable used to.
export function createSendBookingLinkTool(context: ToolContext) {
  const { conversationId, phone } = context;

  return tool({
    description:
      "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name first if not known.",
    inputSchema: z.object({
      guestName: z.string().describe("Guest full name"),
      room: z.enum(["room1", "room2"]).describe("Room they want to book"),
      checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
      checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
    }),
    execute: async ({ guestName, room, checkIn, checkOut }) => {
      const supabase = createAdminClient();
      await supabase.from("booking_link_requests").insert({
        conversation_id: conversationId,
        phone_number: phone,
        guest_name: guestName,
        room,
        check_in: checkIn,
        check_out: checkOut,
      });
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
      const url = `${siteUrl}/booking?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`;
      return { url };
    },
  });
}
