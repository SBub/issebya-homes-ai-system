import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/telegram/auth";
import {
  isCronListCommand,
  isDigestCommand,
  isHeartbeatCommand,
  parseSocialCommand,
} from "@/lib/telegram/command";
import { getPromoCode, markPromoCodeRejected, markPromoCodeSent } from "@/lib/telegram/crm";
import { renderCronJobsList } from "@/lib/telegram/cron-jobs";
import { recordDeliveryFailure } from "@/lib/telegram/delivery-failures";
import { sendDigestNow } from "@/lib/telegram/digest";
import {
  getEscalationByTelegramMessageId,
  resolveEscalation,
  sendGuestMessage,
} from "@/lib/telegram/gca";
import { runCheckHealth } from "@/lib/telegram/health-monitor";
import { renderHealthSummary } from "@/lib/telegram/health-targets";
import { acknowledgeReminder } from "@/lib/telegram/notifications";
import { generateSocialPost } from "@/lib/telegram/social";
import type { TelegramUpdate } from "@/lib/telegram/telegram";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  sendWithRetry,
} from "@/lib/telegram/telegram";

const DONE_PREFIX = "done:";
const NUDGE_APPROVE_PREFIX = "nudge_approve:";
const NUDGE_REJECT_PREFIX = "nudge_reject:";

type CallbackMessage = NonNullable<TelegramUpdate["callback_query"]>["message"];

// Owner tapped "✅ Approve" on a drafted campaign nudge (composed in
// apps/crm/.../check-stalled-guests and campaign-drafts routes). Status check
// guards against a double-tap or webhook retry sending the message twice.
async function handleNudgeApprove(
  callbackQueryId: string,
  message: CallbackMessage,
  promoCodeId: string,
): Promise<void> {
  try {
    const promoCode = await getPromoCode(promoCodeId);

    if (promoCode.status !== "issued") {
      await answerCallbackQuery(callbackQueryId, "Already handled");
      if (message) {
        await editMessageText(message.message_id, `${message.text ?? ""}\n\nAlready handled`);
      }
      return;
    }

    if (!promoCode.guest_phone) {
      throw new Error(`promo code ${promoCodeId} has no guest_phone to send to`);
    }

    const sendResult = await sendGuestMessage(promoCode.guest_phone, promoCode.message_text);
    if (!sendResult.ok) {
      // Row stays 'issued' on failure so tapping Approve again retries it.
      console.error(
        `[telegram-router] nudge send failed for promo code ${promoCodeId}:`,
        sendResult.error,
      );
      await answerCallbackQuery(callbackQueryId, "Failed to send — try again");
      return;
    }

    await markPromoCodeSent(promoCodeId);
    await answerCallbackQuery(callbackQueryId, "Sent ✅");
    if (message) {
      await editMessageText(message.message_id, `${message.text ?? ""}\n\n✅ Sent`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] nudge approve failed:", errorMessage);
    await answerCallbackQuery(callbackQueryId, "Failed to send — try again");
  }
}

// Owner tapped "❌ Reject" — records the decision in CRM, never sends anything.
async function handleNudgeReject(
  callbackQueryId: string,
  message: CallbackMessage,
  promoCodeId: string,
): Promise<void> {
  try {
    const result = await markPromoCodeRejected(promoCodeId);

    if (!result.ok && result.alreadyHandled) {
      await answerCallbackQuery(callbackQueryId, "Already handled");
      if (message) {
        await editMessageText(message.message_id, `${message.text ?? ""}\n\nAlready handled`);
      }
      return;
    }

    if (!result.ok) {
      throw new Error(result.error ?? "mark-rejected failed");
    }

    await answerCallbackQuery(callbackQueryId, "Rejected");
    if (message) {
      await editMessageText(message.message_id, `${message.text ?? ""}\n\n❌ Rejected`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] nudge reject failed:", errorMessage);
    await answerCallbackQuery(callbackQueryId, "Failed to reject — try again");
  }
}

/**
 * Owner replied to a previous escalation nudge. Correlation key is
 * `reply_to_message.message_id` matched against escalations.telegram_message_id
 * via GET /api/escalations/by-telegram-message-id/:id.
 *
 * Returns false on a 404 (or non-text reply) so the caller falls through to
 * its normal command/social-post dispatch — the webhook sees every reply in
 * the chat, not just escalation ones. Returns true once a real escalation
 * nudge is matched, regardless of outcome.
 *
 * Only missing_info has a real reply/resolve action here:
 * - wants_human is inserted with resolved_at already set at creation, so a
 *   reply to it always hits the "Already handled" branch first.
 * - complaint is inserted unresolved but has no auto-resolve action yet, so
 *   it's explicitly guarded below rather than reaching resolveEscalation.
 */
async function handleEscalationReply(
  message: NonNullable<TelegramUpdate["message"]>,
): Promise<boolean> {
  const replyToId = message.reply_to_message?.message_id;
  const answer = message.text;
  if (replyToId === undefined || !answer) {
    return false;
  }

  let escalation: Awaited<ReturnType<typeof getEscalationByTelegramMessageId>>;
  try {
    escalation = await getEscalationByTelegramMessageId(replyToId);
  } catch (err) {
    // Fail open on a real (non-404) lookup failure — fall through rather than
    // silently eat a message that may be unrelated to any escalation.
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] escalation lookup failed:", errorMessage);
    return false;
  }

  if (!escalation) {
    return false;
  }

  if (escalation.resolved_at) {
    await sendMessage("Already handled — this escalation was already resolved.");
    return true;
  }

  if (escalation.reason_category === "complaint") {
    // No auto resolve action for this category yet — do not call resolveEscalation.
    await sendMessage(
      "Noted — this escalation type doesn't have an automatic reply/resolve action yet.",
    );
    return true;
  }

  const resolveResult = await resolveEscalation(escalation.id, answer);
  if (!resolveResult.ok) {
    console.error(
      `[telegram-router] escalation resolve failed for ${escalation.id}:`,
      resolveResult.error,
    );
    await sendMessage("Failed to add the answer to the knowledge base — try replying again.");
    return true;
  }

  if (!resolveResult.resumed) {
    // KB write succeeded but no suspended workflow was found to wake.
    await sendMessage(
      "Added to the knowledge base, but couldn't resume the conversation — you may want to follow up directly.",
    );
    return true;
  }

  // resumed: true means the workflow woke up, not that the guest was messaged yet.
  await sendMessage("✅ Added to the knowledge base — the agent will reply to the guest shortly.");
  return true;
}

/** Sends a social reply with the shared retry-once + durable-fallback behavior. */
async function sendSocialReply(text: string): Promise<void> {
  const result = await sendWithRetry(() => sendMessage(text));
  if (!result.ok) {
    await recordDeliveryFailure("social", text, result.error ?? "sendMessage failed");
  }
}

async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const { id: callbackQueryId, data, message } = callbackQuery;

  if (data?.startsWith(NUDGE_APPROVE_PREFIX)) {
    await handleNudgeApprove(callbackQueryId, message, data.slice(NUDGE_APPROVE_PREFIX.length));
    return;
  }

  if (data?.startsWith(NUDGE_REJECT_PREFIX)) {
    await handleNudgeReject(callbackQueryId, message, data.slice(NUDGE_REJECT_PREFIX.length));
    return;
  }

  if (!data?.startsWith(DONE_PREFIX)) {
    await answerCallbackQuery(callbackQueryId);
    return;
  }

  const key = data.slice(DONE_PREFIX.length);
  try {
    await acknowledgeReminder(key);
    await answerCallbackQuery(callbackQueryId, "Marked done ✅");
    if (message) {
      await editMessageText(message.message_id, `${message.text ?? ""}\n\n✅ Marked done`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] reminder ack failed:", errorMessage);
    await answerCallbackQuery(callbackQueryId, "Failed to mark done — try again");
  }
}

// The one Telegram webhook for the whole system; dispatches by command to
// other apps' logic. Always returns 200 once authenticated — a non-2xx
// makes Telegram retry the whole update.
export async function POST(request: NextRequest) {
  const unauthorized = verifyWebhookSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  if (update?.message?.reply_to_message && update.message.text) {
    const handled = await handleEscalationReply(update.message);
    if (handled) {
      return NextResponse.json({ ok: true });
    }
  }

  if (update && isCronListCommand(update)) {
    await sendMessage(renderCronJobsList());
    return NextResponse.json({ ok: true });
  }

  if (update && isDigestCommand(update)) {
    // On-demand digest send, independent of check-digest's cron schedule.
    const result = await sendDigestNow();
    return NextResponse.json(result);
  }

  if (update && isHeartbeatCommand(update)) {
    // Unlike /digest, always replies with current status directly.
    const results = await runCheckHealth();
    await sendMessage(renderHealthSummary(results));
    return NextResponse.json({ results });
  }

  const idea = update ? parseSocialCommand(update) : null;
  if (!idea) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await generateSocialPost(idea);
    await sendSocialReply(result.altText);
    await sendSocialReply(result.caption);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] generation failed:", message);
    await sendSocialReply(`⚠️ Couldn't generate a social post: ${message}`);
  }

  return NextResponse.json({ ok: true });
}
