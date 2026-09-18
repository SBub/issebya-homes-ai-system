import re
import sys

from fastapi import APIRouter, Depends, Request
from opentelemetry.trace import Span

from app.auth import verify_webhook_secret
from app.gca import answer_booking_link_approval, answer_owner_nudge
from app.models import (
    TelegramCallbackMessage,
    TelegramCallbackQuery,
    TelegramMessage,
    TelegramUpdate,
)
from app.telegram import answer_callback_query, edit_message_text, send_message
from app.tracing import with_span

router = APIRouter()

BOOKING_APPROVE_PREFIX = "booking_approve:"
BOOKING_REJECT_PREFIX = "booking_reject:"

# Matches a `[ref:<correlationId>]` tag at the very end of a missing_info
# nudge's text (see GCA's owner-nudge.ts/missing-info.ts, which embed it two
# newlines after the human-readable nudge body). The correlation id is
# captured as an opaque non-whitespace token, not assumed to be UUID-shaped.
MISSING_INFO_REF_REGEX = re.compile(r"\[ref:(\S+)\]\s*$")

# Matches the guest question quoted in a missing_info nudge's body (see
# owner_nudges.py's `Guest {phone} asked: "{reason}"` composition). Best
# effort: absence just means the answer gets embedded without question
# context, not a failure.
MISSING_INFO_QUESTION_REGEX = re.compile(r'asked: "([^"]*)"')


# Owner tapped ✅ Approve / ❌ Reject on a send_booking_link nudge (composed in
# GCA's booking.ts, relayed through .../owner_nudges.py). There's no DB row to
# check for a double-tap guard — correlation_id only ever identifies a
# (possibly already-resolved, possibly long-gone) suspended run-guest-turn
# Inngest function on GCA's side. A duplicate tap or webhook retry just
# resends the approval event to GCA; if nothing is still waiting on it,
# that's a safe no-op there too (see answer_booking_link_approval's own
# docstring) — so this handler doesn't attempt to detect "already handled".
async def _handle_booking_link_decision(
    callback_query_id: str,
    message: TelegramCallbackMessage | None,
    correlation_id: str,
    approved: bool,
) -> None:
    try:
        result = await answer_booking_link_approval(correlation_id, approved)
        if not result.get("ok"):
            print(
                f"[telegram-router] booking-link {'approve' if approved else 'reject'} failed "
                f"for correlationId {correlation_id}: {result.get('error')}",
                file=sys.stderr,
            )
            await answer_callback_query(callback_query_id, "Failed — try again")
            return

        outcome_label = "✅ Approved" if approved else "❌ Rejected"
        await answer_callback_query(callback_query_id, outcome_label)
        if message is not None:
            await edit_message_text(message.message_id, f"{message.text or ''}\n\n{outcome_label}")
    except Exception as err:  # noqa: BLE001 -- always falls back to the "Failed" toast
        print(f"[telegram-router] booking-link decision failed: {err}", file=sys.stderr)
        await answer_callback_query(callback_query_id, "Failed — try again")


def _extract_missing_info_correlation_id(reply_text: str | None) -> str | None:
    if not reply_text:
        return None
    match = MISSING_INFO_REF_REGEX.search(reply_text)
    return match.group(1) if match else None


def _extract_missing_info_question(reply_text: str | None) -> str | None:
    if not reply_text:
        return None
    match = MISSING_INFO_QUESTION_REGEX.search(reply_text)
    return match.group(1) if match else None


# Owner replied to a previous missing_info nudge. Correlation is entirely
# text-based now — no DB lookup, no GCA API call needed just to find out
# which run (if any) a reply belongs to: the nudge embeds the suspended
# run-guest-turn Inngest function's correlation id as a
# `[ref:<correlationId>]` tag, and Telegram echoes the replied-to message's
# full text back via `reply_to_message.text` on any reply.
#
# Returns False when the reply doesn't carry a ref tag (not a reply, or a
# reply to something other than a missing_info nudge — e.g. wants_human,
# which never invites a reply and so never gets one); the caller ignores the
# return value either way and always responds 200. Returns True once a ref
# tag is matched, regardless of outcome.
async def _handle_owner_nudge_reply(message: TelegramMessage) -> bool:
    reply_to_text = message.reply_to_message.text if message.reply_to_message else None
    correlation_id = _extract_missing_info_correlation_id(reply_to_text)
    answer = message.text
    if not correlation_id or not answer:
        return False
    question = _extract_missing_info_question(reply_to_text)

    answer_result = await answer_owner_nudge(correlation_id, answer, question)
    if not answer_result.get("ok"):
        print(
            f"[telegram-router] owner-nudge answer failed for correlationId {correlation_id}: "
            f"{answer_result.get('error')}",
            file=sys.stderr,
        )
        await send_message("Failed to add the answer to the knowledge base — try replying again.")
        return True

    # GCA (Inngest-backed now) has no way to tell us whether a suspended run
    # was actually still waiting on this answer — see gca.py's
    # answer_owner_nudge docstring. `ok: True` only means the KB write and
    # the wake-up event send both succeeded, not that the guest was messaged
    # yet.
    await send_message(
        "✅ Added to the knowledge base — the agent will reply to the guest shortly."
    )
    return True


async def _handle_callback_query(callback_query: TelegramCallbackQuery) -> None:
    callback_query_id = callback_query.id
    data = callback_query.data
    message = callback_query.message

    if data is not None and data.startswith(BOOKING_APPROVE_PREFIX):
        await _handle_booking_link_decision(
            callback_query_id, message, data[len(BOOKING_APPROVE_PREFIX) :], True
        )
        return

    if data is not None and data.startswith(BOOKING_REJECT_PREFIX):
        await _handle_booking_link_decision(
            callback_query_id, message, data[len(BOOKING_REJECT_PREFIX) :], False
        )
        return

    await answer_callback_query(callback_query_id)


# The one Telegram webhook for the whole system; dispatches by command to
# other apps' logic. Always returns 200 once authenticated — a non-2xx makes
# Telegram retry the whole update. The body is parsed manually here (not via
# a typed Pydantic request parameter) so a malformed or unexpected-shape
# update still reaches the noop branch below instead of FastAPI 422ing
# before this function ever runs.
@router.post("/api/telegram/webhook")
async def post_webhook(
    request: Request, _auth: None = Depends(verify_webhook_secret)
) -> dict[str, bool]:
    try:
        raw_body = await request.json()
        update: TelegramUpdate | None = TelegramUpdate.model_validate(raw_body)
    except Exception:  # noqa: BLE001 -- malformed/unexpected-shape body must still reach noop
        update = None

    async def _dispatch(span: Span) -> dict[str, bool]:
        if update and update.callback_query:
            span.set_attribute("telegram.branch", "callback_query")
            await _handle_callback_query(update.callback_query)
            return {"ok": True}

        if update and update.message and update.message.reply_to_message and update.message.text:
            handled = await _handle_owner_nudge_reply(update.message)
            if handled:
                span.set_attribute("telegram.branch", "owner_nudge_reply")
                return {"ok": True}

        span.set_attribute("telegram.branch", "noop")
        return {"ok": True}

    return await with_span("webhook.telegram_update", {}, _dispatch)
