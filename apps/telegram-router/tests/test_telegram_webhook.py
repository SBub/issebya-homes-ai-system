from unittest.mock import AsyncMock

import httpx
import pytest

from app import gca, main
from app.routers import telegram_webhook

WEBHOOK_URL = "/api/telegram/webhook"
HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}

MISSING_INFO_NUDGE_TEXT = (
    '🔍 Missing info\nGuest +351920742845 asked: "Guest asked about the AC"\n\n'
    "Reply to this message with the answer — I'll send it to the guest and add it "
    "to the knowledge base.\n\n[ref:wf-abc-123]"
)


def _callback_body(
    callback_data: str, message: dict[str, object] | None = None
) -> dict[str, object]:
    return {
        "update_id": 1,
        "callback_query": {
            "id": "cbq-1",
            "data": callback_data,
            "message": message
            or {
                "message_id": 42,
                "text": "📢 Draft (seasonal_nudge) for +351920742845:\n\nHi!",
            },
        },
    }


def _reply_body(text: str, replied_to_text: str | None = None) -> dict[str, object]:
    message: dict[str, object] = {"message_id": 99, "chat": {"id": 123}, "text": text}
    if replied_to_text is not None:
        message["reply_to_message"] = {"message_id": 42, "text": replied_to_text}
    return {"update_id": 2, "message": message}


@pytest.fixture(autouse=True)
def mocks(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
    result = {
        "send_guest_message": AsyncMock(),
        "answer_owner_nudge": AsyncMock(),
        "answer_booking_link_approval": AsyncMock(),
        "answer_callback_query": AsyncMock(return_value={"ok": True}),
        "edit_message_text": AsyncMock(return_value={"ok": True}),
        "send_message": AsyncMock(return_value={"ok": True}),
    }
    monkeypatch.setattr(telegram_webhook, "answer_owner_nudge", result["answer_owner_nudge"])
    monkeypatch.setattr(
        telegram_webhook, "answer_booking_link_approval", result["answer_booking_link_approval"]
    )
    monkeypatch.setattr(telegram_webhook, "answer_callback_query", result["answer_callback_query"])
    monkeypatch.setattr(telegram_webhook, "edit_message_text", result["edit_message_text"])
    monkeypatch.setattr(telegram_webhook, "send_message", result["send_message"])
    # This router never imports send_guest_message — patched at its source
    # module only so tests can assert this flow never reaches for it.
    monkeypatch.setattr(gca, "send_guest_message", result["send_guest_message"])
    return result


BOOKING_NUDGE_MESSAGE = {
    "message_id": 77,
    "text": (
        "🔗 Booking link\nAna wants to book room1 from 2026-09-01 to 2026-09-05.\n\n"
        "Approve sending the booking link to the guest?"
    ),
}

BOOKING_NUDGE_MESSAGE_WITH_PHONE = {
    "message_id": 77,
    "text": (
        "🔗 Booking link\nAna wants to book room1 from 2026-09-01 to 2026-09-05.\n"
        "Guest: +351920742845\n\n"
        "Approve sending the booking link to the guest?"
    ),
}


class TestBookingApproveReject:
    async def test_approve_relays_acks_and_edits(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        res = await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_approve:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        assert res.status_code == 200
        mocks["answer_booking_link_approval"].assert_called_once_with("corr-abc-123", True)
        mocks["answer_callback_query"].assert_called_once_with("cbq-1", "✅ Approved")
        edit_call = mocks["edit_message_text"].call_args
        assert edit_call[0][0] == 77
        assert "✅ Approved" in edit_call[0][1]

    async def test_approve_relay_failure_shows_error_toast(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": False, "error": "GCA down"}

        await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_approve:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        mocks["answer_callback_query"].assert_called_once_with("cbq-1", "Failed — try again")
        mocks["edit_message_text"].assert_not_called()

    async def test_approve_relay_exception_shows_error_toast(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].side_effect = RuntimeError("GCA unreachable")

        await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_approve:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        mocks["answer_callback_query"].assert_called_once_with("cbq-1", "Failed — try again")

    async def test_reject_relays_acks_and_edits(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        res = await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_reject:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        assert res.status_code == 200
        mocks["answer_booking_link_approval"].assert_called_once_with("corr-abc-123", False)
        mocks["answer_callback_query"].assert_called_once_with("cbq-1", "❌ Rejected")
        edit_call = mocks["edit_message_text"].call_args
        assert edit_call[0][0] == 77
        assert "❌ Rejected" in edit_call[0][1]

    async def test_reject_never_touches_owner_nudge_or_guest_message(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_reject:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        mocks["answer_owner_nudge"].assert_not_called()
        mocks["send_guest_message"].assert_not_called()

    async def test_reject_with_phone_edits_in_reminder_and_number(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        res = await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_reject:corr-abc-123", BOOKING_NUDGE_MESSAGE_WITH_PHONE),
            headers=HEADERS,
        )

        assert res.status_code == 200
        mocks["answer_callback_query"].assert_called_once_with("cbq-1", "❌ Rejected")
        edited = mocks["edit_message_text"].call_args[0][1]
        assert edited.startswith(str(BOOKING_NUDGE_MESSAGE_WITH_PHONE["text"]))
        assert 'The guest was told: "Sveta will contact you directly about those dates."' in edited
        assert edited.endswith("Please message them: +351920742845")

    async def test_approve_with_phone_edits_in_approved_suffix(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_approve:corr-abc-123", BOOKING_NUDGE_MESSAGE_WITH_PHONE),
            headers=HEADERS,
        )

        edited = mocks["edit_message_text"].call_args[0][1]
        assert edited.endswith("\n\n✅ Approved. Link sent to the guest.")

    async def test_reject_without_phone_line_falls_back_to_plain_suffix(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_reject:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        edited = mocks["edit_message_text"].call_args[0][1]
        assert edited.endswith("\n\n❌ Rejected")
        assert "Please message them" not in edited

    async def test_approve_without_phone_line_falls_back_to_plain_suffix(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_approve:corr-abc-123", BOOKING_NUDGE_MESSAGE),
            headers=HEADERS,
        )

        edited = mocks["edit_message_text"].call_args[0][1]
        assert edited.endswith("\n\n✅ Approved")

    async def test_callback_message_without_text_still_200(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_booking_link_approval"].return_value = {"ok": True}

        res = await client.post(
            WEBHOOK_URL,
            json=_callback_body("booking_reject:corr-abc-123", {"message_id": 77}),
            headers=HEADERS,
        )

        assert res.status_code == 200
        mocks["edit_message_text"].assert_called_once_with(77, "\n\n❌ Rejected")


class TestReplyToOwnerNudge:
    async def test_reply_to_booking_link_nudge_falls_through(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        res = await client.post(
            WEBHOOK_URL,
            json=_reply_body("ok", str(BOOKING_NUDGE_MESSAGE_WITH_PHONE["text"])),
            headers=HEADERS,
        )

        assert res.status_code == 200
        mocks["answer_owner_nudge"].assert_not_called()

    async def test_non_reply_falls_through(self, client: httpx.AsyncClient, mocks: dict) -> None:
        res = await client.post(
            WEBHOOK_URL, json=_reply_body("just a normal message"), headers=HEADERS
        )

        assert res.status_code == 200
        mocks["answer_owner_nudge"].assert_not_called()

    async def test_unrelated_reply_falls_through(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        res = await client.post(
            WEBHOOK_URL,
            json=_reply_body("just a normal reply", "some earlier chat message"),
            headers=HEADERS,
        )

        assert res.status_code == 200
        assert res.json() == {"ok": True}
        mocks["answer_owner_nudge"].assert_not_called()
        mocks["send_message"].assert_not_called()

    async def test_wants_human_reply_falls_through(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        res = await client.post(
            WEBHOOK_URL,
            json=_reply_body(
                "Just give them a discount",
                "🙋 Wants human\nGuest +351920742845 needs you: Guest is upset about noise\n\n"
                "Conversation: convo-1",
            ),
            headers=HEADERS,
        )

        assert res.status_code == 200
        assert res.json() == {"ok": True}
        mocks["answer_owner_nudge"].assert_not_called()
        mocks["send_message"].assert_not_called()

    async def test_opaque_ref_token_extraction(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_owner_nudge"].return_value = {"ok": True}

        await client.post(
            WEBHOOK_URL,
            json=_reply_body(
                "The AC is above the bed",
                '🔍 Missing info\nGuest +351920742845 asked: "x"\n\n'
                "Reply to this message with the answer — I'll send it to the guest and add "
                "it to the knowledge base.\n\n[ref:sha-2f9a-not-a-uuid]",
            ),
            headers=HEADERS,
        )

        mocks["answer_owner_nudge"].assert_called_once_with(
            "sha-2f9a-not-a-uuid", "The AC is above the bed", "x"
        )

    async def test_never_calls_send_guest_message(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_owner_nudge"].return_value = {"ok": True}

        await client.post(
            WEBHOOK_URL,
            json=_reply_body("The AC is above the bed", MISSING_INFO_NUDGE_TEXT),
            headers=HEADERS,
        )

        mocks["send_guest_message"].assert_not_called()
        mocks["answer_owner_nudge"].assert_called_once_with(
            "wf-abc-123", "The AC is above the bed", "Guest asked about the AC"
        )

    async def test_kb_write_failure_tells_owner(
        self, client: httpx.AsyncClient, mocks: dict
    ) -> None:
        mocks["answer_owner_nudge"].return_value = {"ok": False, "error": "boom"}

        res = await client.post(
            WEBHOOK_URL,
            json=_reply_body("The AC is above the bed", MISSING_INFO_NUDGE_TEXT),
            headers=HEADERS,
        )

        assert res.status_code == 200
        mocks["send_message"].assert_called_once()
        assert (
            "Failed to add the answer to the knowledge base"
            in mocks["send_message"].call_args[0][0]
        )

    async def test_success_confirms_to_owner(self, client: httpx.AsyncClient, mocks: dict) -> None:
        mocks["answer_owner_nudge"].return_value = {"ok": True}

        res = await client.post(
            WEBHOOK_URL,
            json=_reply_body("The AC is above the bed", MISSING_INFO_NUDGE_TEXT),
            headers=HEADERS,
        )

        assert res.status_code == 200
        assert res.json() == {"ok": True}
        mocks["answer_owner_nudge"].assert_called_once_with(
            "wf-abc-123", "The AC is above the bed", "Guest asked about the AC"
        )
        sent_text = mocks["send_message"].call_args[0][0]
        assert (
            "Added to the knowledge base — the agent will reply to the guest shortly" in sent_text
        )


class TestAuth:
    async def test_unauthorized_returns_401(self, client: httpx.AsyncClient) -> None:
        res = await client.post(
            WEBHOOK_URL,
            json=_reply_body("hi"),
            headers={"X-Telegram-Bot-Api-Secret-Token": "wrong-secret"},
        )
        assert res.status_code == 401

    async def test_missing_secret_header_still_401s_and_still_flushes(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The fail-closed auth must stay in front of everything, and the
        # flush middleware must wrap rejected requests too — the rejection
        # itself emits a webhook.telegram_update.rejected span that would
        # otherwise never leave the instance.
        flush = AsyncMock()
        monkeypatch.setattr(main, "flush_tracing", flush)

        res = await client.post(WEBHOOK_URL, json=_reply_body("hi"))

        assert res.status_code == 401
        flush.assert_awaited_once()
