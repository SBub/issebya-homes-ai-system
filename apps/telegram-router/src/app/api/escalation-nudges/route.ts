import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/telegram/auth";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

/**
 * Inbound endpoint for apps/guest-communication-agent's own
 * performEscalation (see @/graph/tools.ts) — this router owns all Telegram
 * I/O, so every escalation category pushes its owner notification through
 * here rather than GCA talking to Telegram itself. This used to be
 * missing_info only, with the other three categories bypassing this router
 * entirely via a raw fetch straight to the Telegram Bot API
 * (sendTelegramNotification, now deleted from GCA) — that bypass is gone,
 * this route is now the sole channel for all four categories.
 *
 * Guarded by requireApiKey (X-API-Key against TELEGRAM_ROUTER_API_KEY),
 * same shape as ../campaign-drafts/route.ts's own guard.
 *
 * Request body: `{ escalationId, phone, reason, reasonCategory,
 * conversationId }`. Unlike campaign-drafts' promoCodeId (embedded in
 * callback_data for a button tap), escalationId isn't put in the message
 * itself — the missing_info reply-correlation flow's key is Telegram's own
 * reply_to_message.message_id, not anything carried in the message text, so
 * escalationId is only present in the request body for validation
 * completeness/parity with the caller's own record. conversationId is only
 * used in the composed message text for non-missing_info categories (see
 * below) — it preserves the "Conversation: <id>" detail the old
 * sendTelegramNotification bypass's message included.
 *
 * Composes the message per reasonCategory:
 *  - missing_info: a plain message (no buttons — the owner is expected to
 *    reply with free text, not tap anything) inviting a reply — unchanged
 *    from before this route handled every category.
 *  - anything else: a plain one-way alert with no reply invitation, matching
 *    the wording of the old sendTelegramNotification bypass. These three
 *    categories have no automatic reply/resolve action (see the webhook
 *    route's handleEscalationReply guard), so no reply is ever invited.
 *
 * Sent via the same sendMessage/sendWithRetry every other Telegram send in
 * this router uses.
 *
 * Returns `{ telegramMessageId }` (Telegram's own returned message id) on a
 * successful send — apps/guest-communication-agent stores this on the
 * escalation row for every category now, so a later reply to this exact
 * message can be matched back to it (see the webhook route's own
 * reply-to-nudge branch, which only acts on it for missing_info). Returns
 * `{ ok: false, error }` with 500 on a Telegram delivery failure (after the
 * retry-once sendWithRetry already gave it a second chance), same as
 * campaign-drafts.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const escalationId = body?.escalationId;
  const phone = body?.phone;
  const reason = body?.reason;
  const reasonCategory = body?.reasonCategory;
  const conversationId = body?.conversationId;

  if (
    !escalationId ||
    typeof escalationId !== "string" ||
    !phone ||
    typeof phone !== "string" ||
    !reason ||
    typeof reason !== "string" ||
    !reasonCategory ||
    typeof reasonCategory !== "string" ||
    !conversationId ||
    typeof conversationId !== "string"
  ) {
    return NextResponse.json(
      {
        error: "Missing escalationId/phone/reason/reasonCategory/conversationId in request body",
      },
      { status: 400 },
    );
  }

  const text =
    reasonCategory === "missing_info"
      ? `🔍 Missing info\nGuest ${phone} asked: "${reason}"\n\nReply to this message with the answer — I'll send it to the guest and add it to the knowledge base.`
      : `Guest ${phone} needs you: ${reason}\n\nConversation: ${conversationId}`;

  const result = await sendWithRetry(() => sendMessage(text));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ telegramMessageId: result.messageId });
}
