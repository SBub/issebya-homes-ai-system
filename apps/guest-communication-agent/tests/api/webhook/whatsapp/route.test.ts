import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// verifyTwilioSignature always passes so these tests can focus on this
// route's own wiring: recording the inbound message, then starting the
// durable runGuestTurn workflow via DBOS.startWorkflow WITHOUT awaiting it,
// and always returning empty TwiML immediately.
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

const ensureDbosLaunchedMock = vi.fn();
vi.mock("@/lib/dbos.js", () => ({
  ensureDbosLaunched: ensureDbosLaunchedMock,
}));

// runGuestTurnWorkflow is just a plain marker value here — the real
// registration is exercised in tests/agent/run-turn.test.ts.
const runGuestTurnWorkflowMock = { name: "runGuestTurn" };
vi.mock("@/agent/run-turn.js", () => ({
  runGuestTurnWorkflow: runGuestTurnWorkflowMock,
}));

const startWorkflowInnerMock = vi.fn();
const dbosStartWorkflowMock = vi.fn(() => startWorkflowInnerMock);
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    startWorkflow: dbosStartWorkflowMock,
  },
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
    ensureDbosLaunchedMock.mockReset();
    dbosStartWorkflowMock.mockClear();
    startWorkflowInnerMock.mockReset();

    getOrCreateActiveConversationMock.mockResolvedValue({ conversationId: "convo-1" });
    recordMessageMock.mockResolvedValue("msg-user-1");
    ensureDbosLaunchedMock.mockResolvedValue(undefined);
    startWorkflowInnerMock.mockResolvedValue({ workflowID: "wf-1" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("records the inbound message, then starts runGuestTurnWorkflow with the recorded message id as triggerMessageId", async () => {
    const res = await POST(
      makeRequest({ From: "whatsapp:+351920742845", Body: "Is room 1 free?" }),
    );

    expect(res.status).toBe(200);
    expect(recordMessageMock).toHaveBeenCalledWith("convo-1", "user", "Is room 1 free?");
    expect(ensureDbosLaunchedMock).toHaveBeenCalled();
    expect(dbosStartWorkflowMock).toHaveBeenCalledWith(runGuestTurnWorkflowMock);
    // The workflow input carries the normalized (bare, "whatsapp:"-stripped)
    // phone even though params.From arrived prefixed — the route normalizes
    // once, right at the ingress boundary, and everything downstream
    // (including the agent workflow) receives that already-clean value.
    expect(startWorkflowInnerMock).toHaveBeenCalledWith({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "Is room 1 free?",
      triggerMessageId: "msg-user-1",
    });
  });

  it("always returns empty TwiML, never a message-bearing response", async () => {
    // startWorkflowInnerMock resolving quickly mirrors DBOS's real "started"
    // resolution, not the workflow's actual completion.
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
    expect(dbosStartWorkflowMock).not.toHaveBeenCalled();
  });
});
