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

const sendBookingLinkSchema = z.object({
  guestName: z.string().describe("Guest full name"),
  room: z.enum(["room1", "room2"]).describe("Room they want to book"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

// Schema-only declaration — no `execute`. Dispatch is manual: run-turn.ts's
// own tool-call step looks up runSendBookingLink below by tool name and
// calls it directly with this turn's ToolContext (conversationId/phone)
// passed as a second argument, rather than delegating to AI SDK's internal
// per-tool execution or (the old approach) closing that context over a
// per-turn factory function. Since the context is now threaded through the
// dispatcher's call instead of a closure, this can be a single module-level
// instance reused across turns, same as pricing.ts/availability.ts/
// property-question.ts.
export const sendBookingLink = tool({
  description:
    "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name first if not known.",
  inputSchema: sendBookingLinkSchema,
});

// The real implementation, called by run-turn.ts's dispatcher with this
// tool call's already-validated input plus the turn's ToolContext (needed to
// attribute the booking_link_requests insert to the right guest).
export async function runSendBookingLink(
  args: z.infer<typeof sendBookingLinkSchema>,
  context: ToolContext,
) {
  const { guestName, room, checkIn, checkOut } = args;
  const { conversationId, phone } = context;
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
}
