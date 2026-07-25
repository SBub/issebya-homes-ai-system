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

/**
 * Owner replied to a previous escalation nudge with free text. Unlike
 * nudge_approve/reject, this isn't a button tap, so there's no
 * callback_data to dispatch on; the correlation key is Telegram's own
 * `reply_to_message.message_id` (the message being replied to), matched
 * against GCA's escalations.telegram_message_id via
 * GET /api/escalations/by-telegram-message-id/:id.
 *
 * Returns `false` when that lookup 404s (or the message isn't a reply with
 * text at all): this message has nothing to do with an escalation — the
 * webhook receives every message in the chat, including replies to
 * unrelated things (a reminder's "Done" prompt, a campaign nudge, or just a
 * normal reply) — so the caller must fall through to its own existing
 * command/social-post dispatch rather than swallowing the message here.
 * Returns `true` once a real escalation nudge is matched, whatever the
 * outcome (already resolved / wrong category / guest-send failed / resolved
 * successfully) — all of those are "handled" as far as the caller's own
 * dispatch is concerned, even though only the last one is a full success.
 *
 * Safety-critical: only missing_info escalations have a real reply/resolve
 * action (the answer gets relayed to the guest over WhatsApp via
 * sendGuestMessage, then embedded in the knowledge base via
 * resolveEscalation, which itself validates reason_category ===
 * "missing_info" and would 400 on anything else — but only *after* the
 * guest-facing send already happened). Now that every category gets a
 * telegram_message_id (previously only missing_info did, which is what made
 * omitting this check safe before), an owner reply to an
 * unhappy_guest/wants_human/complaint nudge — even an internal note never
 * meant for the guest — must NOT be relayed or sent to resolveEscalation at
 * all. This check must run before either of those calls.
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
    // A real failure to reach GCA (not a 404) — can't tell whether this
    // reply was actually meant for an escalation, so fail open: log and let
    // the caller fall through to its normal dispatch rather than risk
    // silently eating an unrelated message the owner expects a response to.
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

  if (escalation.reason_category !== "missing_info") {
    // No automatic reply/resolve action exists for these categories — do
    // NOT call sendGuestMessage or resolveEscalation. See this function's
    // own doc comment for why this guard is safety-critical.
    await sendMessage(
      "Noted — this escalation type doesn't have an automatic reply/resolve action yet.",
    );
    return true;
  }

  const sendResult = await sendGuestMessage(escalation.phone_number, answer);
  if (!sendResult.ok) {
    // Do NOT call GCA's resolve endpoint on a send failure — the escalation
    // stays unresolved so this can be retried by replying again, same
    // "don't mark done on a failed send" contract as handleNudgeApprove.
    console.error(
      `[telegram-router] escalation reply send failed for ${escalation.id}:`,
      sendResult.error,
    );
    await sendMessage("Failed to send to guest — try replying again.");
    return true;
  }

  const resolveResult = await resolveEscalation(escalation.id, answer);
  if (!resolveResult.ok) {
    // The guest already has their answer at this point (sendResult.ok was
    // true above) — this is only GCA's own persist-and-embed step failing,
    // not a failed delivery, so the owner is told the truth (sent, KB write
    // failed) rather than the full success message, which would be wrong.
    console.error(
      `[telegram-router] escalation resolve failed for ${escalation.id}:`,
      resolveResult.error,
    );
    await sendMessage("Sent to guest, but failed to add the answer to the knowledge base.");
    return true;
  }

  await sendMessage("✅ Sent to guest and added to the knowledge base.");
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

  if (update?.message?.reply_to_message && update.message.text) {
    // Checked before the command/social-post dispatch below, alongside
    // (not replacing) the callback_query branch above — but only
    // short-circuits when this really was a reply to one of GCA's
    // escalation nudges. A 404 from the lookup means "unrelated reply," so
    // handleEscalationReply returns false and this falls through to the
    // rest of the existing dispatch unchanged.
    const handled = await handleEscalationReply(update.message);
    if (handled) {
      return NextResponse.json({ ok: true });
    }
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] generation failed:", message);
    await sendSocialReply(`⚠️ Couldn't generate a social post: ${message}`);
  }

  return NextResponse.json({ ok: true });
}
