import json

import pytest
import respx
from httpx import Response

from app.telegram import (
    InlineButton,
    TelegramResult,
    answer_callback_query,
    edit_message_text,
    send_message,
    send_with_retry,
    telegram_configured,
)


class TestTelegramConfigured:
    def test_false_when_either_env_var_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat-id")
        assert telegram_configured() is False

    def test_true_when_both_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat-id")
        assert telegram_configured() is True


class TestSendMessage:
    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "test-chat-id")

    async def test_noop_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
        result = await send_message("hello")
        assert result == {"ok": True}

    @respx.mock
    async def test_posts_chat_id_and_text(self) -> None:
        route = respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(200, json={"ok": True})
        )

        result = await send_message("hello world")

        assert result == {"ok": True}
        assert route.call_count == 1
        request = route.calls.last.request
        assert json.loads(request.content) == {"chat_id": "test-chat-id", "text": "hello world"}

    @respx.mock
    async def test_returns_ok_false_on_http_failure(self) -> None:
        respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(401, json={"ok": False, "description": "Unauthorized"})
        )

        result = await send_message("hello")

        assert result["ok"] is False
        assert "401" in result["error"]
        assert "Unauthorized" in result["error"]

    @respx.mock
    async def test_returns_ok_false_when_telegram_reports_ok_false_on_200(self) -> None:
        respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(200, json={"ok": False, "description": "chat not found"})
        )

        result = await send_message("hello")

        assert result["ok"] is False
        assert "chat not found" in result["error"]

    @respx.mock
    async def test_returns_message_id_on_success(self) -> None:
        respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(200, json={"ok": True, "result": {"message_id": 42}})
        )

        result = await send_message("hello")

        assert result == {"ok": True, "message_id": 42}

    @respx.mock
    async def test_single_inline_button(self) -> None:
        route = respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(200, json={"ok": True})
        )

        await send_message(
            "Reminder text", [InlineButton(text="✅ Done", callback_data="done:rfi_21_2027")]
        )

        body = json.loads(route.calls.last.request.content)
        assert body["reply_markup"] == {
            "inline_keyboard": [[{"text": "✅ Done", "callback_data": "done:rfi_21_2027"}]]
        }

    @respx.mock
    async def test_multiple_buttons_single_row(self) -> None:
        route = respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(200, json={"ok": True})
        )

        await send_message(
            "Draft message",
            [
                InlineButton(text="✅ Approve", callback_data="nudge_approve:promo-1"),
                InlineButton(text="❌ Reject", callback_data="nudge_reject:promo-1"),
            ],
        )

        body = json.loads(route.calls.last.request.content)
        assert body["reply_markup"] == {
            "inline_keyboard": [
                [
                    {"text": "✅ Approve", "callback_data": "nudge_approve:promo-1"},
                    {"text": "❌ Reject", "callback_data": "nudge_reject:promo-1"},
                ]
            ]
        }

    @respx.mock
    async def test_no_reply_markup_when_no_buttons(self) -> None:
        route = respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
            return_value=Response(200, json={"ok": True})
        )

        await send_message("hello")

        body = json.loads(route.calls.last.request.content)
        assert body == {"chat_id": "test-chat-id", "text": "hello"}


class TestSendWithRetry:
    async def test_returns_first_result_without_retrying_on_success(self) -> None:
        calls = 0

        async def send() -> TelegramResult:
            nonlocal calls
            calls += 1
            return {"ok": True}

        result = await send_with_retry(send)
        assert result == {"ok": True}
        assert calls == 1

    async def test_retries_once_on_failure(self) -> None:
        responses: list[TelegramResult] = [
            {"ok": False, "error": "first attempt failed"},
            {"ok": True},
        ]
        responses_iter = iter(responses)
        calls = 0

        async def send() -> TelegramResult:
            nonlocal calls
            calls += 1
            return next(responses_iter)

        result = await send_with_retry(send)
        assert result == {"ok": True}
        assert calls == 2

    async def test_returns_second_failure_without_raising(self) -> None:
        calls = 0

        async def send() -> TelegramResult:
            nonlocal calls
            calls += 1
            return {"ok": False, "error": "still failing"}

        result = await send_with_retry(send)
        assert result == {"ok": False, "error": "still failing"}
        assert calls == 2


class TestAnswerCallbackQuery:
    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")

    async def test_noop_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
        result = await answer_callback_query("cbq-1")
        assert result == {"ok": True}

    @respx.mock
    async def test_posts_callback_query_id_and_text(self) -> None:
        route = respx.post("https://api.telegram.org/bottest-token/answerCallbackQuery").mock(
            return_value=Response(200, json={"ok": True})
        )

        result = await answer_callback_query("cbq-1", "Marked done ✅")

        assert result == {"ok": True}
        body = json.loads(route.calls.last.request.content)
        assert body == {"callback_query_id": "cbq-1", "text": "Marked done ✅"}

    @respx.mock
    async def test_returns_ok_false_on_failure(self) -> None:
        respx.post("https://api.telegram.org/bottest-token/answerCallbackQuery").mock(
            return_value=Response(400, text="boom")
        )

        result = await answer_callback_query("cbq-1")
        assert result["ok"] is False


class TestEditMessageText:
    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "test-chat-id")

    async def test_noop_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
        result = await edit_message_text(42, "updated")
        assert result == {"ok": True}

    @respx.mock
    async def test_posts_new_text_and_clears_keyboard(self) -> None:
        route = respx.post("https://api.telegram.org/bottest-token/editMessageText").mock(
            return_value=Response(200, json={"ok": True})
        )

        result = await edit_message_text(42, "✅ Marked done")

        assert result == {"ok": True}
        body = json.loads(route.calls.last.request.content)
        assert body == {
            "chat_id": "test-chat-id",
            "message_id": 42,
            "text": "✅ Marked done",
            "reply_markup": {"inline_keyboard": []},
        }
