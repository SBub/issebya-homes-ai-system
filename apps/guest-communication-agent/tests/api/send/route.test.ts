import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the module boundaries rather than hitting real Supabase/Twilio — same
// approach as apps/crm's route tests (mock the shared factory/client). Here
// the route itself talks to two separate lib modules (conversations,
// twilio-send), so both are mocked directly rather than mocking fetch
// underneath them.
const getOrCreateActiveConversationMock = vi.fn();
const recordMessageMock = vi.fn();
const sendWhatsAppMessageMock = vi.fn();

vi.mock("@/lib/conversations.js", () => ({
  getOrCreateActiveConversation: getOrCreateActiveConversationMock,
  recordMessage: recordMessageMock,
}));

vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

const { POST } = await import("@/app/api/send/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/send", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/send", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    getOrCreateActiveConversationMock.mockReset();
    recordMessageMock.mockReset();
    sendWhatsAppMessageMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest({ phone: "+351920742845", message: "hi" }, "wrong-key"));
    expect(res.status).toBe(401);
    expect(getOrCreateActiveConversationMock).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is missing from the body", async () => {
    const res = await POST(makeRequest({ message: "hi" }));
    expect(res.status).toBe(400);
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when message is missing from the body", async () => {
    const res = await POST(makeRequest({ phone: "+351920742845" }));
    expect(res.status).toBe(400);
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("looks up/creates the active conversation, sends via Twilio, and records the assistant message on success", async () => {
    getOrCreateActiveConversationMock.mockResolvedValueOnce({
      conversationId: "conv-1",
      isNew: false,
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({ ok: true });
    recordMessageMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      makeRequest({ phone: "+351920742845", message: "Your code is SUMMER10" }),
    );
    const json = await res.json();

    expect(json).toEqual({ ok: true });
    expect(getOrCreateActiveConversationMock).toHaveBeenCalledWith("+351920742845");
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith("+351920742845", "Your code is SUMMER10");
    expect(recordMessageMock).toHaveBeenCalledWith("conv-1", "assistant", "Your code is SUMMER10");
  });

  it("returns 502 with ok: false and the error, without recording a message, on a Twilio failure", async () => {
    getOrCreateActiveConversationMock.mockResolvedValueOnce({
      conversationId: "conv-1",
      isNew: false,
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({
      ok: false,
      error: "Twilio send failed (400): Invalid number",
    });

    const res = await POST(makeRequest({ phone: "+351920742845", message: "hi" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({ ok: false, error: "Twilio send failed (400): Invalid number" });
    expect(recordMessageMock).not.toHaveBeenCalled();
  });
});
