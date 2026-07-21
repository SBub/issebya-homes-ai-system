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
import { sendGuestMessage } from "@/lib/telegram/gca";
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

/**
 * Owner tapped "✅ Approve" on a drafted campaign nudge (see
 * apps/crm/src/app/api/cron/check-stalled-guests/route.ts and
 * ../campaign-drafts/route.ts, which composed this button). Checks the
 * promo code's current status first — a double-tap, or a second webhook
 * retry of the same callback_query, must not send the message twice.
 */
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
      // Do NOT mark-sent on a send failure — the row stays 'issued' so this
      // can be retried by tapping Approve again.
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

/**
 * Owner tapped "❌ Reject" on a drafted campaign nudge. No GCA involvement —
 * this only ever records the decision in CRM, it never sends anything.
 */
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

/**
 * The one Telegram webhook for the whole system. Owns all Telegram I/O and
 * dispatches by command to plain logic APIs in other apps — /social ->
 * apps/social-media, a reminder's "✅ Done" button -> apps/notifications.
 * Always returns 200 once the request is authenticated and parsed, even on
 * downstream failure — a non-2xx response makes Telegram retry the whole
 * update, which would just re-trigger the same action rather than fix
 * anything.
 */
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

  if (update && isCronListCommand(update)) {
    // A direct, synchronous reply to the user's own command — unlike
    // reminders/digest (pushed with nobody watching), there's no need for
    // the retry + durable-fallback treatment: if this fails, the user
    // notices immediately (no reply shows up) and can just retry.
    await sendMessage(renderCronJobsList());
    return NextResponse.json({ ok: true });
  }

  if (update && isDigestCommand(update)) {
    // On-demand digest send, independent of check-digest's eventual
    // schedule — same underlying send (retry + durable-fallback included),
    // just triggered by the user instead of a cron call.
    const result = await sendDigestNow();
    return NextResponse.json(result);
  }

  if (update && isHeartbeatCommand(update)) {
    // On-demand system liveness check, independent of check-health's
    // eventual schedule — same underlying check (persisted state +
    // alert-on-transition included), just triggered by the user instead of a
    // cron call. Unlike /digest, always replies with the current status of
    // every service directly, since a manual trigger means "tell me now,"
    // not just "page me if something changed."
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
    if (!result.notionOk) {
      await sendSocialReply(`⚠️ Notion sync failed: ${result.notionError}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] generation failed:", message);
    await sendSocialReply(`⚠️ Couldn't generate a social post: ${message}`);
  }

  return NextResponse.json({ ok: true });
}
