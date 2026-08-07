import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/telegram/auth";
import { parseSocialCommand } from "@/lib/telegram/command";
import { getPromoCode, markPromoCodeRejected, markPromoCodeSent } from "@/lib/telegram/crm";
import { answerOwnerNudge, sendGuestMessage } from "@/lib/telegram/gca";
import { generateSocialPost } from "@/lib/telegram/social";
import type { TelegramUpdate } from "@/lib/telegram/telegram";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  sendWithRetry,
} from "@/lib/telegram/telegram";

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

// Matches a `[ref:<correlationId>]` tag at the very end of a missing_info
// nudge's text (see GCA's owner-nudge.ts/missing-info.ts, which embed
// it two newlines after the human-readable nudge body). The correlation id
// is captured as an opaque non-whitespace token, not assumed to be
// UUID-shaped.
const MISSING_INFO_REF_REGEX = /\[ref:(\S+)\]\s*$/;

function extractMissingInfoCorrelationId(replyText: string | undefined): string | null {
  if (!replyText) {
    return null;
  }
  const match = replyText.match(MISSING_INFO_REF_REGEX);
  return match ? match[1] : null;
}

/**
 * Owner replied to a previous missing_info nudge. Correlation is entirely
 * text-based now — no DB lookup, no GCA API call needed just to find out
 * which run (if any) a reply belongs to: the nudge embeds the suspended
 * run-guest-turn Inngest function's correlation id as a `[ref:<correlationId>]`
 * tag, and Telegram echoes the replied-to message's full text back via
 * `reply_to_message.text` on any reply.
 *
 * Returns false when the reply doesn't carry a ref tag (not a reply, or a
 * reply to something other than a missing_info nudge — e.g. wants_human,
 * which never invites a reply and so never gets one) so the caller falls
 * through to its normal command/social-post dispatch, same as today's
 * "unrelated reply" case. Returns true once a ref tag is matched, regardless
 * of outcome.
 */
async function handleOwnerNudgeReply(
  message: NonNullable<TelegramUpdate["message"]>,
): Promise<boolean> {
  const correlationId = extractMissingInfoCorrelationId(message.reply_to_message?.text);
  const answer = message.text;
  if (!correlationId || !answer) {
    return false;
  }

  const answerResult = await answerOwnerNudge(correlationId, answer);
  if (!answerResult.ok) {
    console.error(
      `[telegram-router] owner-nudge answer failed for correlationId ${correlationId}:`,
      answerResult.error,
    );
    await sendMessage("Failed to add the answer to the knowledge base — try replying again.");
    return true;
  }

  // GCA (Inngest-backed now) has no way to tell us whether a suspended run
  // was actually still waiting on this answer — see gca.ts's
  // answerOwnerNudge comment. `ok: true` only means the KB write and the
  // wake-up event send both succeeded, not that the guest was messaged yet.
  await sendMessage("✅ Added to the knowledge base — the agent will reply to the guest shortly.");
  return true;
}

/** Sends a social reply with the shared retry-once behavior. */
async function sendSocialReply(text: string): Promise<void> {
  await sendWithRetry(() => sendMessage(text));
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

  await answerCallbackQuery(callbackQueryId);
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
    const handled = await handleOwnerNudgeReply(update.message);
    if (handled) {
      return NextResponse.json({ ok: true });
    }
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
