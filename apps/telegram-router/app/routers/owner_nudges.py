from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from opentelemetry.trace import Span

from app.auth import require_api_key
from app.models import OwnerNudgeRequest
from app.telegram import InlineButton, send_message, send_with_retry
from app.tracing import mark_span_failed, with_span

router = APIRouter()


# Inbound endpoint for apps/guest-communication-agent's own
# requestOwnerNudge (see @/agent/tools/owner-nudge.ts) — this router owns
# all Telegram I/O, so every owner-nudge category pushes its owner
# notification through here rather than GCA talking to Telegram itself.
#
# Guarded by require_api_key (X-API-Key against TELEGRAM_ROUTER_API_KEY).
#
# Composes a distinct message per reason_category, each with its own emoji +
# short label prefix so the owner can tell them apart in Telegram itself,
# without opening the CRM:
#  - missing_info: "🔍 Missing info" — a plain message (no buttons — the
#    owner is expected to reply with free text, not tap anything) inviting a
#    reply, with the `[ref:...]` tag appended.
#  - wants_human: "🙋 Wants human" — a plain one-way alert, no reply
#    invitation, no ref tag.
#  - send_booking_link: "🔗 Booking link" — sent WITH inline ✅ Approve /
#    ❌ Reject buttons (`booking_approve:<correlationId>` /
#    `booking_reject:<correlationId>`, handled by the webhook route's
#    handle_callback_query), unlike the two plain-text categories above. No
#    `[ref:...]` tag: correlationId travels directly in each button's
#    callback_data instead. `correlation_id` is REQUIRED for this category
#    specifically (enforced by OwnerNudgeRequest's model validator) —
#    approval is meaningless without something to correlate it back to.
#    Carries a `Guest: <phone>` line right after the reason, which the
#    webhook reads back out of the echoed message text on a button tap
#    (BOOKING_LINK_GUEST_PHONE_REGEX) so a Reject can tell the owner whom to
#    contact. The phone can't ride in callback_data (Telegram's 64-byte
#    limit), so keep this line in exactly this format.
#
# Returns `{"ok": True}` on a successful send. Returns `{"ok": False, "error"}`
# with 500 on a Telegram delivery failure (after the retry-once
# send_with_retry already gave it a second chance).
@router.post("/api/owner-nudges")
async def post_owner_nudges(
    body: OwnerNudgeRequest, _auth: None = Depends(require_api_key)
) -> JSONResponse:
    async def _send(span: Span) -> JSONResponse:
        phone = body.phone
        reason = body.reason
        reason_category = body.reason_category
        conversation_id = body.conversation_id
        correlation_id = body.correlation_id

        if reason_category == "missing_info":
            text = (
                f'🔍 Missing info\nGuest {phone} asked: "{reason}"\n\n'
                "Reply to this message with the answer — I'll send it to the guest "
                "and add it to the knowledge base."
            )
            if correlation_id:
                text += f"\n\n[ref:{correlation_id}]"
        elif reason_category == "wants_human":
            text = f"🙋 Wants human\nGuest {phone} needs you: {reason}\n\nConversation: {conversation_id}"
        elif reason_category == "send_booking_link":
            text = (
                f"🔗 Booking link\n{reason}\nGuest: {phone}\n\n"
                "Approve sending the booking link to the guest?"
            )
        else:
            text = f"Guest {phone} needs you: {reason}\n\nConversation: {conversation_id}"

        if reason_category == "send_booking_link" and correlation_id:
            approve_button = InlineButton(
                text="✅ Approve", callback_data=f"booking_approve:{correlation_id}"
            )
            reject_button = InlineButton(
                text="❌ Reject", callback_data=f"booking_reject:{correlation_id}"
            )
            result = await send_with_retry(
                lambda: send_message(text, [approve_button, reject_button])
            )
            if not result.get("ok"):
                mark_span_failed(span, result.get("error") or "sendMessage failed")
                return JSONResponse({"ok": False, "error": result.get("error")}, status_code=500)
            return JSONResponse({"ok": True})

        result = await send_with_retry(lambda: send_message(text))
        if not result.get("ok"):
            mark_span_failed(span, result.get("error") or "sendMessage failed")
            return JSONResponse({"ok": False, "error": result.get("error")}, status_code=500)
        return JSONResponse({"ok": True})

    return await with_span(
        "owner_nudges.send",
        {"gca.reason_category": body.reason_category, "gca.conversation_id": body.conversation_id},
        _send,
    )
