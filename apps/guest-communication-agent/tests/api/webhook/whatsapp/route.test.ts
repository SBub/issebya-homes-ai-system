import { AIMessage } from "@langchain/core/messages";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the module boundary for every dependency this route touches, same
// "mock the shared factory/module, not the network" convention as every
// other route test in this app. verifyTwilioSignature is stubbed to always
// pass so these tests can focus on the graph.invoke() wiring, in particular
// this route's new triggerMessageId threading (see @/lib/conversations.js's
// recordMessage now returning the new whatsapp_messages row's id, and
// @/graph/tools.ts's performEscalation, which is what actually consumes
// configurable.triggerMessageId mid-graph).
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

const graphInvokeMock = vi.fn();
vi.mock("@/graph/graph.js", () => ({
  graph: { invoke: graphInvokeMock },
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
    graphInvokeMock.mockReset();

    getOrCreateActiveConversationMock.mockResolvedValue({
      conversationId: "convo-1",
      isNew: false,
    });
    recordMessageMock.mockResolvedValueOnce("msg-user-1");
    recordMessageMock.mockResolvedValueOnce("msg-assistant-1");
    touchGuestContactMock.mockResolvedValue({ ok: true });
    deriveStageHintMock.mockReturnValue(undefined);
    graphInvokeMock.mockResolvedValue({
      messages: [new AIMessage("Yes, room 1 is available!")],
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
    expect(graphInvokeMock).toHaveBeenCalledWith(
      {
        conversationId: "convo-1",
        phone: "whatsapp:+351920742845",
        incomingMessage: "Is room 1 free?",
      },
      expect.objectContaining({
        configurable: expect.objectContaining({
          conversationId: "convo-1",
          phone: "whatsapp:+351920742845",
          thread_id: "convo-1",
          triggerMessageId: "msg-user-1",
        }),
        runId: expect.any(String),
      }),
    );
  });

  it("still records the assistant reply after the graph call, unaffected by the id-returning recordMessage change", async () => {
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
    expect(graphInvokeMock).not.toHaveBeenCalled();
  });
});
