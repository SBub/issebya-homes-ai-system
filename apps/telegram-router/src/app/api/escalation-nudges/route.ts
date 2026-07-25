import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/telegram/auth";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

/**
 * Inbound endpoint for apps/guest-communication-agent's own
 * performEscalation (see @/graph/tools.ts) — this router owns all Telegram
 * I/O, so a missing_info escalation pushes a "here's a guest question you
 * need to answer" nudge here instead of GCA talking to Telegram itself (the
 * way the other three escalation categories still do via
 * sendTelegramNotification — that raw bypass is untouched, this route only
 * replaces it for missing_info).
 *
 * Guarded by requireApiKey (X-API-Key against TELEGRAM_ROUTER_API_KEY),
 * same shape as ../campaign-drafts/route.ts's own guard.
 *
 * Request body: `{ escalationId, phone, reason }`. Unlike campaign-drafts'
 * promoCodeId (embedded in callback_data for a button tap), escalationId
 * isn't put in the message itself — this flow's correlation key is
 * Telegram's own reply_to_message.message_id, not anything carried in the
 * message text, so escalationId is only present in the request body for
 * validation completeness/parity with the caller's own record.
 *
 * Composes a plain message (no buttons — the owner is expected to reply
 * with free text, not tap anything) inviting a reply, sent via the same
 * sendMessage/sendWithRetry every other Telegram send in this router uses.
 *
 * Returns `{ telegramMessageId }` (Telegram's own returned message id) on a
 * successful send — apps/guest-communication-agent stores this on the
 * escalation row so a later reply to this exact message can be matched back
 * to it (see the webhook route's own reply-to-nudge branch). Returns
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

  if (
    !escalationId ||
    typeof escalationId !== "string" ||
    !phone ||
    typeof phone !== "string" ||
    !reason ||
    typeof reason !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing escalationId/phone/reason in request body" },
      { status: 400 },
    );
  }

  const text = `🔍 Missing info\nGuest ${phone} asked: "${reason}"\n\nReply to this message with the answer — I'll send it to the guest and add it to the knowledge base.`;

  const result = await sendWithRetry(() => sendMessage(text));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ telegramMessageId: result.messageId });
}
