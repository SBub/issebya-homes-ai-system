import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the module boundary, not the network — same approach as
// apps/crm's route tests. sendMessage/sendWithRetry are real (not the
// network) but Telegram isn't configured in this test env, so they no-op
// unless we stub TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID and mock fetch
// instead — simpler to just mock the telegram module directly here since
// we only care that this route calls it correctly.
const sendMessageMock = vi.fn();
const sendWithRetryMock = vi.fn((send: () => Promise<unknown>) => send());
vi.mock("@/lib/telegram/telegram.js", () => ({
  sendMessage: sendMessageMock,
  sendWithRetry: sendWithRetryMock,
}));

const { POST } = await import("@/app/api/campaign-drafts/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3003/api/campaign-drafts", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/campaign-drafts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_ROUTER_API_KEY = "test-key";
    sendMessageMock.mockReset();
    sendWithRetryMock.mockClear();
    sendMessageMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const validBody = {
    promoCodeId: "promo-1",
    campaignKind: "seasonal_nudge",
    guestPhone: "+351920742845",
    messageText: "Hi! Just checking in...",
  };

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest(validBody, "wrong-key"));
    expect(res.status).toBe(401);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ promoCodeId: "promo-1" }));
    expect(res.status).toBe(400);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("sends a draft message with Approve/Reject buttons keyed to the promo code id", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(json).toEqual({ ok: true });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [text, buttons] = sendMessageMock.mock.calls[0];
    expect(text).toContain("seasonal_nudge");
    expect(text).toContain("+351920742845");
    expect(text).toContain("Hi! Just checking in...");
    expect(buttons).toEqual([
      { text: "✅ Approve", callbackData: "nudge_approve:promo-1" },
      { text: "❌ Reject", callbackData: "nudge_reject:promo-1" },
    ]);
  });

  it("returns 500 with the error when the send fails even after retry", async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: "Telegram down" });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Telegram down" });
  });
});
