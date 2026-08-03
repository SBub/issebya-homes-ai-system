import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the module boundary for every dependency this route touches.
// verifyTwilioSignature always passes so these tests can focus on this
// route's own wiring: recording the inbound message, then starting the
// durable runGuestTurn workflow (@/agent/run-guest-turn.ts) via
// DBOS.startWorkflow WITHOUT awaiting it, and always returning empty TwiML
// immediately — this route no longer awaits runAgentTurn or builds a
// message-bearing TwiML response at all; see run-guest-turn.ts for where
// that logic now lives.
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
vi.mock("@/lib/crm.js", () => ({
  registerGuestContact: registerGuestContactMock,
}));

const ensureDbosLaunchedMock = vi.fn();
vi.mock("@/lib/dbos.js", () => ({
  ensureDbosLaunched: ensureDbosLaunchedMock,
}));

// runGuestTurnWorkflow itself is just a plain marker value here — the real
// registration (DBOS.registerWorkflow) is exercised in
// tests/agent/run-guest-turn.test.ts, not this file. This route only needs
// to prove it passes the right value to DBOS.startWorkflow.
const runGuestTurnWorkflowMock = { name: "runGuestTurn" };
vi.mock("@/agent/run-guest-turn.js", () => ({
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
    registerGuestContactMock.mockReset();
    ensureDbosLaunchedMock.mockReset();
    dbosStartWorkflowMock.mockClear();
    startWorkflowInnerMock.mockReset();

    getOrCreateActiveConversationMock.mockResolvedValue({
      conversationId: "convo-1",
      isNew: false,
    });
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
    expect(startWorkflowInnerMock).toHaveBeenCalledWith({
      conversationId: "convo-1",
      phone: "whatsapp:+351920742845",
      incomingMessage: "Is room 1 free?",
      triggerMessageId: "msg-user-1",
    });
  });

  it("always returns empty TwiML, never a message-bearing response", async () => {
    // The route does `await DBOS.startWorkflow(fn)(input)` (mirrors
    // harness-engineering/server/index.ts) — that await only waits for the
    // workflow to be durably STARTED (DBOS's own real semantics), not for
    // it to finish; startWorkflowInnerMock resolving quickly here mirrors
    // that real "started" resolution, not the workflow's actual completion.
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

  it("registers a new guest contact when the conversation is new", async () => {
    getOrCreateActiveConversationMock.mockResolvedValue({ conversationId: "convo-1", isNew: true });
    registerGuestContactMock.mockResolvedValue({ ok: true });

    await POST(makeRequest({ From: "whatsapp:+351920742845", Body: "Hi!" }));

    expect(registerGuestContactMock).toHaveBeenCalledWith("whatsapp:+351920742845");
  });
});
