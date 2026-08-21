import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/telegram/auth";
import { answerBookingLinkApproval, answerOwnerNudge } from "@/lib/telegram/gca";
import { answerCallbackQuery, editMessageText, sendMessage } from "@/lib/telegram/telegram";
import type { TelegramUpdate } from "@/lib/telegram/telegram";
import { markSpanFailed, withSpan } from "@/lib/tracing";

const BOOKING_APPROVE_PREFIX = "booking_approve:";
const BOOKING_REJECT_PREFIX = "booking_reject:";

type CallbackMessage = NonNullable<TelegramUpdate["callback_query"]>["message"];

// Owner tapped ✅ Approve / ❌ Reject on a send_booking_link nudge (composed
// in GCA's booking.ts, relayed through .../api/owner-nudges/route.ts).
// There's no DB row to check for a double-tap guard — correlationId only
// ever identifies a (possibly already-resolved, possibly long-gone)
// suspended run-guest-turn Inngest function on GCA's side. A duplicate tap
// or webhook retry just resends the approval event to GCA; if nothing is
// still waiting on it, that's a safe no-op there too (see
// answerBookingLinkApproval's own comment) — so this handler doesn't
// attempt to detect "already handled".
async function handleBookingLinkDecision(
  callbackQueryId: string,
  message: CallbackMessage,
  correlationId: string,
  approved: boolean,
): Promise<void> {
  try {
    const result = await answerBookingLinkApproval(correlationId, approved);
    if (!result.ok) {
      console.error(
        `[telegram-router] booking-link ${approved ? "approve" : "reject"} failed for correlationId ${correlationId}:`,
        result.error,
      );
      await answerCallbackQuery(callbackQueryId, "Failed — try again");
      return;
    }

    const outcomeLabel = approved ? "✅ Approved" : "❌ Rejected";
    await answerCallbackQuery(callbackQueryId, outcomeLabel);
    if (message) {
      await editMessageText(message.message_id, `${message.text ?? ""}\n\n${outcomeLabel}`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] booking-link decision failed:", errorMessage);
    await answerCallbackQuery(callbackQueryId, "Failed — try again");
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
 * which never invites a reply and so never gets one); the caller ignores
 * the return value either way and always responds 200. Returns true once a
 * ref tag is matched, regardless of outcome.
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

async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const { id: callbackQueryId, data, message } = callbackQuery;

  if (data?.startsWith(BOOKING_APPROVE_PREFIX)) {
    await handleBookingLinkDecision(
      callbackQueryId,
      message,
      data.slice(BOOKING_APPROVE_PREFIX.length),
      true,
    );
    return;
  }

  if (data?.startsWith(BOOKING_REJECT_PREFIX)) {
    await handleBookingLinkDecision(
      callbackQueryId,
      message,
      data.slice(BOOKING_REJECT_PREFIX.length),
      false,
    );
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
    await withSpan(
      "webhook.telegram_update.rejected",
      { "http.status_code": 401 },
      async (span) => {
        markSpanFailed(span, "Unauthorized — invalid or missing webhook secret");
      },
    );
    return unauthorized;
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  return withSpan("webhook.telegram_update", {}, async (span) => {
    if (update?.callback_query) {
      span.setAttribute("telegram.branch", "callback_query");
      await handleCallbackQuery(update.callback_query);
      return NextResponse.json({ ok: true });
    }

    if (update?.message?.reply_to_message && update.message.text) {
      const handled = await handleOwnerNudgeReply(update.message);
      if (handled) {
        span.setAttribute("telegram.branch", "owner_nudge_reply");
        return NextResponse.json({ ok: true });
      }
    }

    span.setAttribute("telegram.branch", "noop");
    return NextResponse.json({ ok: true });
  });
}
