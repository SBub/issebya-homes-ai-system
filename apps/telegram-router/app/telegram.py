import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TypedDict

import httpx
import sentry_sdk
from opentelemetry.trace import Span

from app.tracing import mark_span_failed, with_span

TELEGRAM_API = "https://api.telegram.org"


class TelegramResult(TypedDict, total=False):
    ok: bool
    error: str
    message_id: int


@dataclass
class InlineButton:
    text: str
    callback_data: str


def telegram_configured() -> bool:
    """Telegram delivery is optional and best-effort, same contract as every
    other app's telegram.py in this repo: a missing TELEGRAM_BOT_TOKEN/
    TELEGRAM_CHAT_ID (or any delivery failure) no-ops / returns a result
    object rather than throwing.
    """
    return bool(os.getenv("TELEGRAM_BOT_TOKEN")) and bool(os.getenv("TELEGRAM_CHAT_ID"))


def _parse_telegram_response(response: httpx.Response, action: str) -> dict[str, object]:
    try:
        body: dict[str, object] = response.json()
    except ValueError:
        body = {}
    if not response.is_success or not body.get("ok"):
        description = body.get("description")
        if description is None:
            description = json.dumps(body)
        raise RuntimeError(f"Telegram {action} failed ({response.status_code}): {description}")
    return body


async def send_message(text: str, buttons: list[InlineButton] | None = None) -> TelegramResult:
    """Plain text message, optionally with one row of inline buttons (e.g. the
    send_booking_link approve/reject prompt's two buttons — pass
    `[approve_button, reject_button]`). All buttons render in a single row, in
    list order.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"ok": True}

    async def _send(span: Span) -> TelegramResult:
        try:
            payload: dict[str, object] = {"chat_id": chat_id, "text": text}
            if buttons:
                payload["reply_markup"] = {
                    "inline_keyboard": [
                        [
                            {"text": button.text, "callback_data": button.callback_data}
                            for button in buttons
                        ]
                    ]
                }
            async with httpx.AsyncClient() as client:
                response = await client.post(f"{TELEGRAM_API}/bot{token}/sendMessage", json=payload)
            body = _parse_telegram_response(response, "sendMessage")
            result: TelegramResult = {"ok": True}
            message_result = body.get("result")
            if isinstance(message_result, dict) and "message_id" in message_result:
                result["message_id"] = message_result["message_id"]
            return result
        except Exception as err:  # noqa: BLE001 -- caught and downgraded to {ok: False}
            mark_span_failed(span, err)
            sentry_sdk.capture_exception(err)
            return {"ok": False, "error": str(err)}

    return await with_span("telegram.send_message", {}, _send)


async def send_with_retry[T: TelegramResult](
    send: Callable[[], Awaitable[T]],
) -> T:
    """Retries a send once on failure (2 attempts total) — every Telegram send in
    this router gets the same retry-once behavior. Never throws: `send` itself
    (e.g. `send_message`) already turns failures into a `{ ok: False }` result.
    """
    first = await send()
    if first.get("ok"):
        return first
    return await send()


async def answer_callback_query(callback_query_id: str, text: str | None = None) -> TelegramResult:
    """Must be called after handling any callback_query — otherwise the pressed
    button shows a stuck loading spinner in the Telegram client indefinitely.
    `text` (optional) shows as a brief toast to the user who pressed it.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        return {"ok": True}

    async def _send(span: Span) -> TelegramResult:
        try:
            payload: dict[str, object] = {"callback_query_id": callback_query_id}
            if text is not None:
                payload["text"] = text
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{TELEGRAM_API}/bot{token}/answerCallbackQuery", json=payload
                )
            _parse_telegram_response(response, "answerCallbackQuery")
            return {"ok": True}
        except Exception as err:  # noqa: BLE001 -- caught and downgraded to {ok: False}
            mark_span_failed(span, err)
            sentry_sdk.capture_exception(err)
            return {"ok": False, "error": str(err)}

    return await with_span("telegram.answer_callback", {}, _send)


async def edit_message_text(message_id: int, text: str) -> TelegramResult:
    """Edits a previously-sent message's text and clears its inline keyboard (e.g. after ack)."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"ok": True}

    async def _send(span: Span) -> TelegramResult:
        try:
            payload: dict[str, object] = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text,
                "reply_markup": {"inline_keyboard": []},
            }
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{TELEGRAM_API}/bot{token}/editMessageText", json=payload
                )
            _parse_telegram_response(response, "editMessageText")
            return {"ok": True}
        except Exception as err:  # noqa: BLE001 -- caught and downgraded to {ok: False}
            mark_span_failed(span, err)
            sentry_sdk.capture_exception(err)
            return {"ok": False, "error": str(err)}

    return await with_span("telegram.edit_message", {}, _send)
