import os
import sys

from fastapi import HTTPException, Request

from app.tracing import mark_span_failed, tracer


async def verify_webhook_secret(request: Request) -> None:
    """Checked against Telegram's X-Telegram-Bot-Api-Secret-Token header — set on
    every request Telegram sends once the webhook is registered with a
    `secret_token` (via setWebhook), so this endpoint can't be triggered by an
    arbitrary POST body shaped like a Telegram update.
    """
    expected = os.getenv("TELEGRAM_WEBHOOK_SECRET")
    if not expected:
        print(
            "[telegram-router] TELEGRAM_WEBHOOK_SECRET is not set — all webhook requests "
            "will be rejected",
            file=sys.stderr,
        )
    provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if not expected or provided != expected:
        with tracer.start_as_current_span(
            "webhook.telegram_update.rejected", attributes={"http.status_code": 401}
        ) as span:
            mark_span_failed(span, "Unauthorized — invalid or missing webhook secret")
        raise HTTPException(status_code=401, detail="Unauthorized")


async def require_api_key(request: Request) -> None:
    """Shared X-Api-Key check for POST /api/owner-nudges, checked against
    TELEGRAM_ROUTER_API_KEY — same require_api_key pattern every other app in
    this repo already uses (apps/guest-communication-agent's own
    requireApiKey), this app just hasn't needed one before now: it's only ever
    been a caller of other apps' X-API-Key-guarded routes (verify_webhook_secret
    above guards this app's own inbound webhook instead), never a callee
    itself. apps/guest-communication-agent's own requestOwnerNudge (see
    @/agent/tools/owner-nudge.ts) is the caller.
    """
    expected = os.getenv("TELEGRAM_ROUTER_API_KEY")
    if not expected:
        print(
            "[telegram-router] TELEGRAM_ROUTER_API_KEY is not set — all requests will be rejected",
            file=sys.stderr,
        )
    provided = request.headers.get("X-API-Key")
    if not expected or provided != expected:
        with tracer.start_as_current_span(
            "owner_nudges.send.rejected", attributes={"http.status_code": 401}
        ) as span:
            mark_span_failed(span, "Unauthorized — invalid or missing X-API-Key")
        raise HTTPException(status_code=401, detail="Unauthorized")
