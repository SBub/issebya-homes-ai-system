import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the module boundary, not the network — same approach as
// tests/app/api/campaign-drafts/route.test.ts.
const sendMessageMock = vi.fn();
const sendWithRetryMock = vi.fn((send: () => Promise<unknown>) => send());
vi.mock("@/lib/telegram/telegram.js", () => ({
  sendMessage: sendMessageMock,
  sendWithRetry: sendWithRetryMock,
}));

const { POST } = await import("@/app/api/escalation-nudges/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3003/api/escalation-nudges", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/escalation-nudges", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_ROUTER_API_KEY = "test-key";
    sendMessageMock.mockReset();
    sendWithRetryMock.mockClear();
    sendMessageMock.mockResolvedValue({ ok: true, messageId: 4242 });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const validBody = {
    escalationId: "esc-1",
    phone: "+351920742845",
    reason: "Guest asked about the AC, couldn't find it in the knowledge base",
  };

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest(validBody, "wrong-key"));
    expect(res.status).toBe(401);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ escalationId: "esc-1" }));
    expect(res.status).toBe(400);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("sends a reply-inviting message and returns the telegram message id", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(json).toEqual({ telegramMessageId: 4242 });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [text] = sendMessageMock.mock.calls[0];
    expect(text).toContain("+351920742845");
    expect(text).toContain("Guest asked about the AC, couldn't find it in the knowledge base");
    expect(text.toLowerCase()).toContain("reply");
  });

  it("returns 500 with the error when the send fails even after retry", async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: "Telegram down" });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Telegram down" });
  });
});
