from typing import ClassVar
from unittest.mock import AsyncMock

import httpx
import pytest

from app.routers import owner_nudges

OWNER_NUDGES_URL = "/api/owner-nudges"

VALID_BODY = {
    "phone": "+351920742845",
    "reason": "Guest asked about the AC, couldn't find it in the knowledge base",
    "reasonCategory": "missing_info",
    "conversationId": "convo-1",
}


@pytest.fixture(autouse=True)
def mocks(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    monkeypatch.setenv("TELEGRAM_ROUTER_API_KEY", "test-key")
    send_message_mock = AsyncMock(return_value={"ok": True, "message_id": 4242})
    monkeypatch.setattr(owner_nudges, "send_message", send_message_mock)
    return {"send_message": send_message_mock}


def _headers(api_key: str = "test-key") -> dict[str, str]:
    return {"X-API-Key": api_key}


async def test_rejects_invalid_api_key(client: httpx.AsyncClient, mocks: dict) -> None:
    res = await client.post(OWNER_NUDGES_URL, json=VALID_BODY, headers=_headers("wrong-key"))
    assert res.status_code == 401
    mocks["send_message"].assert_not_called()


async def test_missing_required_fields_is_422(client: httpx.AsyncClient, mocks: dict) -> None:
    res = await client.post(OWNER_NUDGES_URL, json={"phone": "+351920742845"}, headers=_headers())
    assert res.status_code == 422
    mocks["send_message"].assert_not_called()


async def test_missing_reason_category_is_422(client: httpx.AsyncClient, mocks: dict) -> None:
    body = {k: v for k, v in VALID_BODY.items() if k != "reasonCategory"}
    res = await client.post(OWNER_NUDGES_URL, json=body, headers=_headers())
    assert res.status_code == 422
    mocks["send_message"].assert_not_called()


async def test_missing_conversation_id_is_422(client: httpx.AsyncClient, mocks: dict) -> None:
    body = {k: v for k, v in VALID_BODY.items() if k != "conversationId"}
    res = await client.post(OWNER_NUDGES_URL, json=body, headers=_headers())
    assert res.status_code == 422
    mocks["send_message"].assert_not_called()


async def test_missing_info_sends_reply_inviting_message(
    client: httpx.AsyncClient, mocks: dict
) -> None:
    res = await client.post(OWNER_NUDGES_URL, json=VALID_BODY, headers=_headers())

    assert res.json() == {"ok": True}
    mocks["send_message"].assert_called_once()
    text = mocks["send_message"].call_args[0][0]
    assert "+351920742845" in text
    assert "Guest asked about the AC, couldn't find it in the knowledge base" in text
    assert "reply" in text.lower()


async def test_missing_info_appends_ref_tag_when_correlation_id_supplied(
    client: httpx.AsyncClient, mocks: dict
) -> None:
    res = await client.post(
        OWNER_NUDGES_URL,
        json={**VALID_BODY, "correlationId": "corr-abc-123"},
        headers=_headers(),
    )

    assert res.json() == {"ok": True}
    text = mocks["send_message"].call_args[0][0]
    assert text.endswith("\n\n[ref:corr-abc-123]")


async def test_missing_info_omits_ref_tag_when_no_correlation_id(
    client: httpx.AsyncClient, mocks: dict
) -> None:
    await client.post(OWNER_NUDGES_URL, json=VALID_BODY, headers=_headers())

    text = mocks["send_message"].call_args[0][0]
    assert "[ref:" not in text


async def test_wants_human_sends_plain_alert_with_no_ref_tag(
    client: httpx.AsyncClient, mocks: dict
) -> None:
    res = await client.post(
        OWNER_NUDGES_URL,
        json={
            **VALID_BODY,
            "reasonCategory": "wants_human",
            "reason": "Guest is upset about noise",
            "correlationId": "corr-abc-123",
        },
        headers=_headers(),
    )

    assert res.json() == {"ok": True}
    mocks["send_message"].assert_called_once()
    text = mocks["send_message"].call_args[0][0]
    assert text == (
        "🙋 Wants human\nGuest +351920742845 needs you: Guest is upset about noise\n\n"
        "Conversation: convo-1"
    )
    assert "reply to this message" not in text.lower()
    assert "[ref:" not in text


async def test_returns_500_when_send_fails_after_retry(
    client: httpx.AsyncClient, mocks: dict
) -> None:
    mocks["send_message"].return_value = {"ok": False, "error": "Telegram down"}

    res = await client.post(OWNER_NUDGES_URL, json=VALID_BODY, headers=_headers())

    assert res.status_code == 500
    assert res.json() == {"ok": False, "error": "Telegram down"}


class TestSendBookingLink:
    BOOKING_BODY: ClassVar[dict[str, str]] = {
        "phone": "+351920742845",
        "reason": "Ana wants to book room1 from 2026-09-01 to 2026-09-05.",
        "reasonCategory": "send_booking_link",
        "conversationId": "convo-1",
        "correlationId": "corr-abc-123",
    }

    async def test_missing_correlation_id_is_422(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        body = {k: v for k, v in self.BOOKING_BODY.items() if k != "correlationId"}
        res = await client.post(OWNER_NUDGES_URL, json=body, headers=_headers())

        assert res.status_code == 422
        mocks["send_message"].assert_not_called()

    async def test_sends_reason_text_with_approve_reject_buttons(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        res = await client.post(OWNER_NUDGES_URL, json=self.BOOKING_BODY, headers=_headers())

        assert res.json() == {"ok": True}
        mocks["send_message"].assert_called_once()
        call_args = mocks["send_message"].call_args[0]
        text, buttons = call_args[0], call_args[1]
        assert "Ana wants to book room1 from 2026-09-01 to 2026-09-05." in text
        assert [(b.text, b.callback_data) for b in buttons] == [
            ("✅ Approve", "booking_approve:corr-abc-123"),
            ("❌ Reject", "booking_reject:corr-abc-123"),
        ]

    async def test_includes_guest_phone_line(self, client: httpx.AsyncClient, mocks: dict) -> None:
        await client.post(OWNER_NUDGES_URL, json=self.BOOKING_BODY, headers=_headers())

        text, buttons = mocks["send_message"].call_args[0][:2]
        assert "\nGuest: +351920742845\n" in text
        assert [(b.text, b.callback_data) for b in buttons] == [
            ("✅ Approve", "booking_approve:corr-abc-123"),
            ("❌ Reject", "booking_reject:corr-abc-123"),
        ]

    async def test_does_not_append_ref_tag(self, client: httpx.AsyncClient, mocks: dict) -> None:
        await client.post(OWNER_NUDGES_URL, json=self.BOOKING_BODY, headers=_headers())

        text = mocks["send_message"].call_args[0][0]
        assert "[ref:" not in text

    async def test_does_not_reuse_promo_code_callback_prefixes(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        await client.post(OWNER_NUDGES_URL, json=self.BOOKING_BODY, headers=_headers())

        buttons = mocks["send_message"].call_args[0][1]
        for button in buttons:
            assert not button.callback_data.startswith("nudge_")

    async def test_returns_500_when_send_fails_after_retry(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["send_message"].return_value = {"ok": False, "error": "Telegram down"}

        res = await client.post(OWNER_NUDGES_URL, json=self.BOOKING_BODY, headers=_headers())

        assert res.status_code == 500
        assert res.json() == {"ok": False, "error": "Telegram down"}
