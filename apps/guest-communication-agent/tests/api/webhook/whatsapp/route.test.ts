import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the module boundary for every dependency this route touches, same
// "mock the shared factory/module, not the network" convention as every
// other route test in this app. verifyTwilioSignature is stubbed to always
// pass so these tests can focus on the runAgentTurn() wiring, in particular
// this route's triggerMessageId threading (see @/lib/conversations.js's
// recordMessage now returning the new whatsapp_messages row's id, and
// @/agent/tools/escalation.ts's performEscalation, which is what actually
// consumes configurable.triggerMessageId mid-turn).
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

const registerGuestContactMock = vi.fn();
const touchGuestContactMock = vi.fn();
vi.mock("@/lib/crm.js", () => ({
  registerGuestContact: registerGuestContactMock,
  touchGuestContact: touchGuestContactMock,
}));

const deriveStageHintMock = vi.fn();
vi.mock("@/lib/funnel-stage.js", () => ({
  deriveStageHint: deriveStageHintMock,
}));

const runAgentTurnMock = vi.fn();
vi.mock("@/agent/run-turn.js", () => ({
  runAgentTurn: runAgentTurnMock,
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
    registerGuestContactMock.mockReset();
    touchGuestContactMock.mockReset();
    deriveStageHintMock.mockReset();
    runAgentTurnMock.mockReset();

    getOrCreateActiveConversationMock.mockResolvedValue({
      conversationId: "convo-1",
      isNew: false,
    });
    recordMessageMock.mockResolvedValueOnce("msg-user-1");
    recordMessageMock.mockResolvedValueOnce("msg-assistant-1");
    touchGuestContactMock.mockResolvedValue({ ok: true });
    deriveStageHintMock.mockReturnValue(undefined);
    runAgentTurnMock.mockResolvedValue({
      messages: [{ role: "assistant", content: "Yes, room 1 is available!" }],
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("passes the recorded user message id through as configurable.triggerMessageId", async () => {
    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    expect(res.status).toBe(200);
    expect(recordMessageMock).toHaveBeenNthCalledWith(1, "convo-1", "user", "Is room 1 free?");
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      {
        conversationId: "convo-1",
        phone: "whatsapp:+351920742845",
        incomingMessage: "Is room 1 free?",
      },
      { triggerMessageId: "msg-user-1" },
    );
  });

  it("still records the assistant reply after the agent turn, unaffected by the id-returning recordMessage change", async () => {
    await POST(makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }));

    expect(recordMessageMock).toHaveBeenNthCalledWith(
      2,
      "convo-1",
      "assistant",
      "Yes, room 1 is available!",
      expect.any(String),
    );
  });

  it("rejects requests with an invalid Twilio signature", async () => {
    verifyTwilioSignatureMock.mockReturnValue(false);

    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    expect(res.status).toBe(401);
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it("returns a message-bearing TwiML response for a normal turn", async () => {
    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    const body = await res.text();
    expect(body).toBe("<Response><Message>Yes, room 1 is available!</Message></Response>");
  });

  it("suppresses the guest-facing reply (empty TwiML) and never records it when missingInfoEscalated is true", async () => {
    runAgentTurnMock.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content:
            "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
        },
      ],
      missingInfoEscalated: true,
    });

    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is there a juicer in the kitchen?" }),
    );

    const body = await res.text();
    expect(res.status).toBe(200);
    // Valid, empty TwiML — Twilio relays nothing to the guest this turn.
    expect(body).toBe("<Response></Response>");

    // Not recorded at all (not just undelivered) — a real test showed
    // recording it here poisoned the later re-invocation's loaded history
    // (the model read its own "I've let the owner know" reply as "already
    // handled" and skipped re-searching) — see the route's own doc comment.
    // Only the guest's own inbound message (call #1) is ever recorded.
    expect(recordMessageMock).toHaveBeenCalledTimes(1);
    expect(recordMessageMock).toHaveBeenNthCalledWith(
      1,
      "convo-1",
      "user",
      "Is there a juicer in the kitchen?",
    );
  });
});
