import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/telegram/auth";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

/**
 * Inbound endpoint for apps/crm's POST /api/cron/check-stalled-guests (via
 * src/lib/telegram-router-client.ts's postCampaignDraft) — this router owns
 * all Telegram I/O, so CRM pushes a "here's a drafted follow-up" request
 * here instead of talking to Telegram itself.
 *
 * Guarded by requireApiKey (X-API-Key against TELEGRAM_ROUTER_API_KEY), the
 * same pattern every other app's inbound API-key-guarded route already
 * uses — this app just hasn't needed one before (see auth.ts's own doc
 * comment on requireApiKey).
 *
 * Request body: `{ promoCodeId, campaignKind, guestPhone, messageText }`.
 * Composes a draft message and sends it with two inline buttons —
 * "✅ Approve" (`nudge_approve:<promoCodeId>`) and "❌ Reject"
 * (`nudge_reject:<promoCodeId>`) — which the webhook route's
 * handleCallbackQuery (src/app/api/telegram/webhook/route.ts) recognizes.
 *
 * Returns `{ ok: true }` on a successful send, or `{ ok: false, error }`
 * with 500 on a Telegram delivery failure (after the retry-once
 * sendWithRetry already gave it a second chance).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const promoCodeId = body?.promoCodeId;
  const campaignKind = body?.campaignKind;
  const guestPhone = body?.guestPhone ?? null;
  const messageText = body?.messageText;

  if (
    !promoCodeId ||
    typeof promoCodeId !== "string" ||
    !campaignKind ||
    typeof campaignKind !== "string" ||
    !messageText ||
    typeof messageText !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing promoCodeId/campaignKind/messageText in request body" },
      { status: 400 },
    );
  }

  const text = `📢 Draft (${campaignKind}) for ${guestPhone ?? "unknown phone"}:\n\n${messageText}`;
  const approveButton = { text: "✅ Approve", callbackData: `nudge_approve:${promoCodeId}` };
  const rejectButton = { text: "❌ Reject", callbackData: `nudge_reject:${promoCodeId}` };

  const result = await sendWithRetry(() => sendMessage(text, [approveButton, rejectButton]));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
