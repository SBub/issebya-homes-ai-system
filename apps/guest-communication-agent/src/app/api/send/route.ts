import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

/**
 * Proactive outbound send. New capability for this app — until now GCA has
 * only ever replied synchronously as TwiML inside the inbound webhook call
 * (POST /api/webhook/whatsapp); it has never sent a message on its own
 * initiative. The intended caller is a later phase's Telegram
 * approve/reject flow, once the owner approves a drafted promo-code
 * follow-up (see apps/crm's new GET /api/promo-codes/[id], which supplies
 * the message_text and guest_phone this route needs) — that orchestration
 * is explicitly NOT built here.
 *
 * Guarded by requireApiKey (X-API-Key against
 * GUEST_COMMUNICATION_AGENT_API_KEY), unlike the webhook route, which is
 * guarded by Twilio's own signature instead — see ./../../../lib/auth.ts's
 * own doc comment for why.
 *
 * Request body: `{ phone: string, message: string }`.
 *
 * Reuses getOrCreateActiveConversation (the same conversation-continuity
 * helper the inbound webhook route uses) rather than inventing a parallel
 * conversation path, so a proactive send lands in the guest's existing
 * active conversation (or starts one, same as an inbound message would).
 * On a successful Twilio send, calls the existing recordMessage(...,
 * "assistant", message) so this outbound message shows up in the same
 * whatsapp_messages history a normal reply would.
 *
 * Returns `{ ok: true }` on success. On a Twilio API failure (invalid
 * number, rate limit, etc. — a real external call that can fail), returns
 * `{ ok: false, error }` with status 502 rather than throwing an unhandled
 * error. In that failure case, recordMessage is deliberately skipped: the
 * message was never actually delivered, so recording it as sent would
 * misrepresent the conversation history.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  const message = body?.message;
  if (!phone || typeof phone !== "string" || !message || typeof message !== "string") {
    return NextResponse.json({ error: "Missing phone/message in request body" }, { status: 400 });
  }

  const { conversationId } = await getOrCreateActiveConversation(phone);

  const result = await sendWhatsAppMessage(phone, message);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  await recordMessage(conversationId, "assistant", message);

  return NextResponse.json({ ok: true });
}
