from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

# Minimal shape of Telegram's webhook Update payload — only the fields this
# app reads. All wrapper fields (message, callback_query, and the optional
# nested ones) are optional: the webhook route parses the request body itself
# (see routers/telegram_webhook.py), never via a typed FastAPI request
# parameter, precisely so a malformed or unexpected-shape update still
# reaches the always-200 noop branch instead of failing validation.


class TelegramChat(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int


class TelegramReplyToMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message_id: int
    text: str | None = None


class TelegramMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message_id: int
    chat: TelegramChat
    text: str | None = None
    # Present when this message is itself a reply to another message — the
    # owner-nudge reply flow (routers/telegram_webhook.py's
    # handle_owner_nudge_reply) reads `reply_to_message.text` (Telegram
    # echoes the full text of the replied-to message) and regex-matches it
    # for a `[ref:<correlationId>]` tag to correlate the owner's free-text
    # answer back to the specific suspended run-guest-turn Inngest function
    # that sent the original missing_info nudge — no DB lookup involved.
    reply_to_message: TelegramReplyToMessage | None = None


class TelegramCallbackMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # The message the button was attached to — needed to edit it after ack.
    message_id: int
    text: str | None = None


class TelegramCallbackQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    data: str | None = None
    message: TelegramCallbackMessage | None = None


class TelegramUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    update_id: int | None = None
    message: TelegramMessage | None = None
    callback_query: TelegramCallbackQuery | None = None


class OwnerNudgeRequest(BaseModel):
    """Request body for POST /api/owner-nudges.

    One deliberate, issue-sanctioned behavior change from the Next.js
    version: this replaces the hand-rolled `400` validation (eight
    `!x || typeof x !== "string"` checks) with FastAPI's own `422`.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    phone: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    reason_category: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    correlation_id: str | None = None

    @field_validator("correlation_id", mode="before")
    @classmethod
    def _coerce_correlation_id(cls, value: object) -> str | None:
        # Mirrors the TS route's own coercion: a present-but-falsy or
        # non-string correlationId is silently treated as absent, not
        # rejected outright.
        return value if isinstance(value, str) and value else None

    @model_validator(mode="after")
    def _require_correlation_id_for_booking_link(self) -> "OwnerNudgeRequest":
        if self.reason_category == "send_booking_link" and not self.correlation_id:
            raise ValueError(
                "Missing correlationId in request body — required for send_booking_link"
            )
        return self
