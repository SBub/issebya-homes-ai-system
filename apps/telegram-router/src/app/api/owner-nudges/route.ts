import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/telegram/auth";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";
import { markSpanFailed, withSpan } from "@/lib/tracing";

/**
 * Inbound endpoint for apps/guest-communication-agent's own
 * requestOwnerNudge (see @/agent/tools/owner-nudge.ts) — this router
 * owns all Telegram I/O, so every owner-nudge category pushes its owner
 * notification through here rather than GCA talking to Telegram itself.
 *
 * Guarded by requireApiKey (X-API-Key against TELEGRAM_ROUTER_API_KEY),
 * same shape as ../campaign-drafts/route.ts's own guard.
 *
 * Request body: `{ phone, reason, reasonCategory, conversationId,
 * correlationId? }`. There's no escalationId anymore — GCA's escalations
 * table is gone (see supabase/migrations/*_drop_escalations_table.sql).
 * Instead, for missing_info, GCA passes its current run's correlation id as
 * `correlationId`; this route embeds it as a `[ref:<correlationId>]` tag at
 * the very end of the composed text (two newlines after the human-readable
 * body) so a later owner reply can be correlated back to that exact
 * suspended run-guest-turn Inngest function via Telegram's own
 * `reply_to_message.text` (see the webhook route's handleOwnerNudgeReply) —
 * no DB round-trip. wants_human never passes correlationId (it's a one-way
 * notification, no reply expected), so its text never gets a ref tag.
 *
 * Composes a distinct message per reasonCategory, each with its own
 * emoji + short label prefix so the owner can tell them apart in Telegram
 * itself, without opening the CRM:
 *  - missing_info: "🔍 Missing info" — a plain message (no buttons — the
 *    owner is expected to reply with free text, not tap anything) inviting a
 *    reply, with the `[ref:...]` tag appended.
 *  - wants_human: "🙋 Wants human" — a plain one-way alert, no reply
 *    invitation, no ref tag.
 *  - send_booking_link: "🔗 Booking link" — sent WITH inline ✅ Approve /
 *    ❌ Reject buttons (`booking_approve:<correlationId>` /
 *    `booking_reject:<correlationId>`, handled by the webhook route's
 *    handleCallbackQuery), unlike the two plain-text categories above.
 *    `reason` already contains the human-readable guest/room/dates summary
 *    GCA's runSendBookingLink built — reused as-is, not re-parsed here. No
 *    `[ref:...]` tag: correlationId travels directly in each button's
 *    callback_data instead, which is more reliable than round-tripping it
 *    through Telegram's reply-echo text. `correlationId` is REQUIRED for this
 *    category specifically — approval is meaningless without something to
 *    correlate it back to.
 *
 * Sent via the same sendMessage/sendWithRetry every other Telegram send in
 * this router uses.
 *
 * Returns `{ ok: true }` on a successful send. Returns `{ ok: false, error }`
 * with 500 on a Telegram delivery failure (after the retry-once
 * sendWithRetry already gave it a second chance), same as campaign-drafts.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  const reason = body?.reason;
  const reasonCategory = body?.reasonCategory;
  const conversationId = body?.conversationId;
  const rawCorrelationId = body?.correlationId;
  const correlationId =
    typeof rawCorrelationId === "string" && rawCorrelationId ? rawCorrelationId : undefined;

  if (
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
      { error: "Missing phone/reason/reasonCategory/conversationId in request body" },
      { status: 400 },
    );
  }

  if (reasonCategory === "send_booking_link" && !correlationId) {
    return NextResponse.json(
      { error: "Missing correlationId in request body — required for send_booking_link" },
      { status: 400 },
    );
  }

  return withSpan(
    "owner_nudges.send",
    { "gca.reason_category": reasonCategory, "gca.conversation_id": conversationId },
    async (span) => {
      let text: string;
      switch (reasonCategory) {
        case "missing_info":
          text = `🔍 Missing info\nGuest ${phone} asked: "${reason}"\n\nReply to this message with the answer — I'll send it to the guest and add it to the knowledge base.`;
          if (correlationId) {
            text += `\n\n[ref:${correlationId}]`;
          }
          break;
        case "wants_human":
          text = `🙋 Wants human\nGuest ${phone} needs you: ${reason}\n\nConversation: ${conversationId}`;
          break;
        case "send_booking_link":
          text = `🔗 Booking link\n${reason}\n\nApprove sending the booking link to the guest?`;
          break;
        default:
          text = `Guest ${phone} needs you: ${reason}\n\nConversation: ${conversationId}`;
      }

      if (reasonCategory === "send_booking_link" && correlationId) {
        const approveButton = {
          text: "✅ Approve",
          callbackData: `booking_approve:${correlationId}`,
        };
        const rejectButton = { text: "❌ Reject", callbackData: `booking_reject:${correlationId}` };
        const result = await sendWithRetry(() => sendMessage(text, [approveButton, rejectButton]));
        if (!result.ok) {
          markSpanFailed(span, result.error ?? "sendMessage failed");
          return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
        }
        return NextResponse.json({ ok: true });
      }

      const result = await sendWithRetry(() => sendMessage(text));
      if (!result.ok) {
        markSpanFailed(span, result.error ?? "sendMessage failed");
        return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    },
  );
}
