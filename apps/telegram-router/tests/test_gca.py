import json

import pytest
import respx
from httpx import Response

from app.gca import answer_booking_link_approval, answer_owner_nudge, send_guest_message


@pytest.fixture(autouse=True)
def _gca_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GUEST_COMMUNICATION_AGENT_API_URL", "http://localhost:3005")
    monkeypatch.setenv("GUEST_COMMUNICATION_AGENT_API_KEY", "test-key")


class TestSendGuestMessage:
    async def test_throws_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GUEST_COMMUNICATION_AGENT_API_URL")
        with pytest.raises(
            RuntimeError,
            match="GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY "
            "are not configured",
        ):
            await send_guest_message("+351920742845", "hi")

    @respx.mock
    async def test_posts_and_returns_ok_true_on_success(self) -> None:
        route = respx.post("http://localhost:3005/api/send").mock(
            return_value=Response(200, json={"ok": True})
        )

        result = await send_guest_message("+351920742845", "Hi! Just checking in...")

        assert result == {"ok": True}
        request = route.calls.last.request
        assert request.headers["X-API-Key"] == "test-key"
        assert request.headers["Content-Type"] == "application/json"
        assert json.loads(request.content) == {
            "phone": "+351920742845",
            "message": "Hi! Just checking in...",
        }

    @respx.mock
    async def test_returns_ok_false_with_gcas_own_error(self) -> None:
        respx.post("http://localhost:3005/api/send").mock(
            return_value=Response(502, json={"ok": False, "error": "invalid number"})
        )

        result = await send_guest_message("+351920742845", "hi")

        assert result == {"ok": False, "error": "invalid number"}

    @respx.mock
    async def test_returns_generic_error_when_body_has_no_error_field(self) -> None:
        respx.post("http://localhost:3005/api/send").mock(return_value=Response(502, text=""))

        result = await send_guest_message("+351920742845", "hi")

        assert result["ok"] is False
        assert "502" in result["error"]


class TestAnswerOwnerNudge:
    async def test_throws_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GUEST_COMMUNICATION_AGENT_API_URL")
        with pytest.raises(
            RuntimeError,
            match="GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY "
            "are not configured",
        ):
            await answer_owner_nudge("corr-abc-123", "The AC is above the bed")

    @respx.mock
    async def test_posts_answer_and_returns_ok_true_on_success(self) -> None:
        route = respx.post("http://localhost:3005/api/owner-nudges/corr-abc-123/answer").mock(
            return_value=Response(200, json={"ok": True})
        )

        result = await answer_owner_nudge("corr-abc-123", "The AC is above the bed")

        assert result == {"ok": True}
        request = route.calls.last.request
        assert request.headers["X-API-Key"] == "test-key"
        assert request.headers["Content-Type"] == "application/json"
        assert json.loads(request.content) == {"answer": "The AC is above the bed"}

    @respx.mock
    async def test_returns_ok_false_on_real_failure(self) -> None:
        respx.post("http://localhost:3005/api/owner-nudges/corr-abc-123/answer").mock(
            return_value=Response(500, text="boom")
        )

        result = await answer_owner_nudge("corr-abc-123", "The AC is above the bed")

        assert result["ok"] is False
        assert "500" in result["error"]


class TestAnswerBookingLinkApproval:
    async def test_throws_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GUEST_COMMUNICATION_AGENT_API_URL")
        with pytest.raises(
            RuntimeError,
            match="GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY "
            "are not configured",
        ):
            await answer_booking_link_approval("corr-abc-123", True)

    @respx.mock
    async def test_posts_approved_true_on_success(self) -> None:
        route = respx.post("http://localhost:3005/api/owner-nudges/corr-abc-123/approve").mock(
            return_value=Response(200, json={"ok": True})
        )

        result = await answer_booking_link_approval("corr-abc-123", True)

        assert result == {"ok": True}
        request = route.calls.last.request
        assert request.headers["X-API-Key"] == "test-key"
        assert request.headers["Content-Type"] == "application/json"
        assert json.loads(request.content) == {"approved": True}

    @respx.mock
    async def test_posts_approved_false_for_rejection(self) -> None:
        route = respx.post("http://localhost:3005/api/owner-nudges/corr-abc-123/approve").mock(
            return_value=Response(200, json={"ok": True})
        )

        await answer_booking_link_approval("corr-abc-123", False)

        assert json.loads(route.calls.last.request.content) == {"approved": False}

    @respx.mock
    async def test_returns_ok_false_on_real_failure(self) -> None:
        respx.post("http://localhost:3005/api/owner-nudges/corr-abc-123/approve").mock(
            return_value=Response(500, text="boom")
        )

        result = await answer_booking_link_approval("corr-abc-123", True)

        assert result["ok"] is False
        assert "500" in result["error"]
