from unittest.mock import AsyncMock

import httpx
import pytest

from app import main
from app.tracing import flush_tracing

HEALTH_URL = "/api/health"


class TestFlushTracingMiddleware:
    async def test_flush_runs_after_every_request(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flush = AsyncMock()
        monkeypatch.setattr(main, "flush_tracing", flush)

        res = await client.get(HEALTH_URL)

        assert res.status_code == 200
        flush.assert_awaited_once()

    async def test_flush_failure_does_not_change_the_response(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The production flush_tracing swallows its own exceptions, so this
        # pins the middleware itself: it must not introduce a new failure path
        # between the handler and the response even if that guard is ever
        # weakened. A raising flush would otherwise surface as a 500, which for
        # the Telegram webhook means Telegram retrying every update.
        monkeypatch.setattr(
            main, "flush_tracing", AsyncMock(side_effect=RuntimeError("axiom down"))
        )

        res = await client.get(HEALTH_URL)

        assert res.status_code == 200
        assert res.json() == {"ok": True}


class TestFlushTracing:
    async def test_flush_tracing_is_a_noop_without_an_sdk_provider(self) -> None:
        # conftest.py's ASGITransport never runs the lifespan, so no SDK
        # provider is ever configured. The isinstance guard is what keeps the
        # rest of the suite from doing real flush work on every request.
        await flush_tracing()
