import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// verifyTwilioSignature always passes so these tests can focus on this
// route's own wiring: recording the inbound message, then triggering the
// durable run-guest-turn Inngest function via inngest.send WITHOUT awaiting
// its result, and always returning empty TwiML immediately.
const verifyTwilioSignatureMock = vi.fn(() => true);
vi.mock("@/lib/twilio.js", () => ({
  verifyTwilioSignature: verifyTwilioSignatureMock,
}));

const getOrCreateActiveConversationMock = vi.fn();
const recordMessageMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  getOrCreateActiveConversation: getOrCreateActiveConversationMock,
  recordMessage: recordMessageMock,
}));

const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock },
}));

// run-turn.ts pulls in generateText/langsmith/langchain/openrouter — heavy,
// unrelated dependencies this route doesn't need. Mocked wholesale (down to
// a single marker constant), matching how the DBOS-era version of this test
// mocked runGuestTurnWorkflow as a plain marker value rather than importing
// the real module.
const GUEST_TURN_REQUESTED_EVENT = "gca/guest-turn.requested";
vi.mock("@/agent/run-turn.js", () => ({
  GUEST_TURN_REQUESTED_EVENT,
}));

const { POST } = await import("@/app/api/webhook/whatsapp/route.js");

function makeRequest(body: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3005/api/webhook/whatsapp", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": "sig",
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe("POST /api/webhook/whatsapp", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    process.env.TWILIO_WEBHOOK_URL = "https://example.com/api/webhook/whatsapp";
    verifyTwilioSignatureMock.mockReset().mockReturnValue(true);
    getOrCreateActiveConversationMock.mockReset();
    recordMessageMock.mockReset();
    inngestSendMock.mockReset();

    getOrCreateActiveConversationMock.mockResolvedValue({ conversationId: "convo-1" });
    recordMessageMock.mockResolvedValue("msg-user-1");
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("records the inbound message, then sends GUEST_TURN_REQUESTED_EVENT with the recorded message id as triggerMessageId and a freshly generated correlationId", async () => {
    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    expect(res.status).toBe(200);
    expect(recordMessageMock).toHaveBeenCalledWith("convo-1", "user", "Is room 1 free?");
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
    const [sentEvent] = inngestSendMock.mock.calls[0];
    expect(sentEvent.name).toBe(GUEST_TURN_REQUESTED_EVENT);
    // The workflow input carries the normalized (bare, "whatsapp:"-stripped)
    // phone even though params.From arrived prefixed — the route normalizes
    // once, right at the ingress boundary, and everything downstream
    // (including the agent function) receives that already-clean value.
    expect(sentEvent.data).toEqual({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "Is room 1 free?",
      triggerMessageId: "msg-user-1",
      correlationId: expect.any(String),
    });
    // A real, non-empty UUID — generated once, here, not left undefined.
    expect(sentEvent.data.correlationId.length).toBeGreaterThan(0);
  });

  it("always returns empty TwiML, never a message-bearing response", async () => {
    // inngestSendMock resolving quickly mirrors Inngest's real "accepted"
    // resolution, not the triggered function's actual completion.
    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toBe("<Response></Response>");
  });

  it("rejects requests with an invalid Twilio signature", async () => {
    verifyTwilioSignatureMock.mockReturnValue(false);

    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    expect(res.status).toBe(401);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });
});
