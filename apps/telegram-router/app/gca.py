import os
from typing import TypedDict
from urllib.parse import quote

import httpx
from opentelemetry.trace import Span

from app.tracing import mark_span_failed, with_span


class SendGuestMessageResult(TypedDict, total=False):
    ok: bool
    error: str


def _require_gca_config() -> tuple[str, str]:
    base_url = os.getenv("GUEST_COMMUNICATION_AGENT_API_URL")
    api_key = os.getenv("GUEST_COMMUNICATION_AGENT_API_KEY")
    if not base_url or not api_key:
        raise RuntimeError(
            "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured"
        )
    return base_url, api_key


async def send_guest_message(phone: str, message: str) -> SendGuestMessageResult:
    """Calls GCA's POST /api/send — guest-facing WhatsApp delivery once the owner
    taps "✅ Approve" on a drafted campaign nudge.

    Missing config raises (a deployment mistake). A real send failure (GCA's
    own {ok: False, error} response) is returned as `{ok: False, error}`
    instead, since the caller must branch on it, not treat it as an exception.
    """
    base_url, api_key = _require_gca_config()

    async def _call(span: Span) -> SendGuestMessageResult:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/api/send",
                json={"phone": phone, "message": message},
                headers={"X-API-Key": api_key},
            )
        try:
            body: dict[str, object] = response.json()
        except ValueError:
            body = {}
        if not response.is_success or not body.get("ok"):
            error = (
                body.get("error")
                or f"guest-communication-agent /api/send failed ({response.status_code})"
            )
            mark_span_failed(span, error)
            return {"ok": False, "error": str(error)}
        return {"ok": True}

    return await with_span("gca.relay.send_guest_message", {"gca.endpoint": "/api/send"}, _call)


class AnswerOwnerNudgeResult(TypedDict, total=False):
    ok: bool
    error: str


async def answer_owner_nudge(
    correlation_id: str, answer: str, question: str | None = None
) -> AnswerOwnerNudgeResult:
    """Calls GCA's POST /api/owner-nudges/:correlationId/answer: writes the KB
    entry, then sends the event that wakes GCA's suspended run-guest-turn
    Inngest function so it can compose and send the real reply itself.
    `correlation_id` is the suspended function's own correlation id, extracted
    by the webhook route straight out of the owner's Telegram reply (the
    `[ref:<correlationId>]` tag embedded in the original missing_info nudge)
    — there's no DB lookup involved anymore.

    Unlike the old DBOS-backed version, GCA has no way to tell us whether a
    suspended run was actually still waiting on this answer — Inngest gives no
    such signal (sending an event nobody's waiting on isn't an error, it's
    simply never consumed). So this only reports whether the call itself
    succeeded, NOT whether the guest was actually messaged (that happens
    later, inside the resumed run, invisible to this router either way) and
    NOT whether anything was actually resumed. There's no more 409/
    already-resolved outcome — no DB row exists to hold that state.

    `question` is the guest's original question, extracted from the nudge's
    echoed reply text (best-effort — may be omitted), so GCA can embed the
    answer alongside its question instead of storing the bare answer alone.
    """
    base_url, api_key = _require_gca_config()

    async def _call(span: Span) -> AnswerOwnerNudgeResult:
        payload: dict[str, object] = {"answer": answer}
        if question is not None:
            payload["question"] = question
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/api/owner-nudges/{quote(correlation_id, safe='')}/answer",
                json=payload,
                headers={"X-API-Key": api_key},
            )
        if not response.is_success:
            error = (
                f"GCA answer for correlationId {correlation_id} failed "
                f"({response.status_code}): {response.text}"
            )
            mark_span_failed(span, error)
            return {"ok": False, "error": error}
        return {"ok": True}

    return await with_span(
        "gca.relay.answer_owner_nudge",
        {
            "gca.endpoint": "/api/owner-nudges/:correlationId/answer",
            "gca.correlation_id": correlation_id,
        },
        _call,
    )


class AnswerBookingLinkApprovalResult(TypedDict, total=False):
    ok: bool
    error: str


async def answer_booking_link_approval(
    correlation_id: str, approved: bool
) -> AnswerBookingLinkApprovalResult:
    """Calls GCA's POST /api/owner-nudges/:correlationId/approve: relays the
    owner's approve/reject decision (tapped as a Telegram button, not typed as
    free text) so GCA can send the event that wakes its suspended
    run-guest-turn Inngest function — see booking.ts's
    waitForBookingLinkApproval/handleBookingLinkApprovalReceived.
    `correlation_id` rides directly in the tapped button's callback_data (see
    the webhook route's handle_callback_query), not parsed out of reply text
    the way answer_owner_nudge's missing_info flow does.

    Same "no resumed signal" contract as answer_owner_nudge: GCA has no way to
    tell us whether a suspended run was actually still waiting on this
    decision, so this only reports whether the call itself succeeded. A
    duplicate tap (or webhook retry) just resends an event nobody's waiting on
    if it was already resolved — a safe no-op, same reasoning as
    answer_owner_nudge, which is also why there's no DB-backed double-tap guard
    possible here (there's no row to check).
    """
    base_url, api_key = _require_gca_config()

    async def _call(span: Span) -> AnswerBookingLinkApprovalResult:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/api/owner-nudges/{quote(correlation_id, safe='')}/approve",
                json={"approved": approved},
                headers={"X-API-Key": api_key},
            )
        if not response.is_success:
            error = (
                f"GCA approve for correlationId {correlation_id} failed "
                f"({response.status_code}): {response.text}"
            )
            mark_span_failed(span, error)
            return {"ok": False, "error": error}
        return {"ok": True}

    return await with_span(
        "gca.relay.answer_booking_link_approval",
        {
            "gca.endpoint": "/api/owner-nudges/:correlationId/approve",
            "gca.correlation_id": correlation_id,
            "gca.approved": approved,
        },
        _call,
    )
