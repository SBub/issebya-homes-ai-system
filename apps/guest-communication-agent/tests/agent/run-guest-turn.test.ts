import { beforeEach, describe, expect, it, vi } from "vitest";

// This file only proves the wrapper's own wiring — runAgentTurn's own
// behavior is covered by tests/agent/run-turn.test.ts. registerWorkflow is
// mocked to just return the plain function, so this file can call
// runGuestTurnWorkflow directly like any other async function.
const runAgentTurnMock = vi.fn();
vi.mock("@/agent/run-turn.js", () => ({
  runAgentTurn: runAgentTurnMock,
}));

const recordMessageMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  recordMessage: recordMessageMock,
}));

const touchGuestContactMock = vi.fn();
vi.mock("@/lib/crm.js", () => ({
  touchGuestContact: touchGuestContactMock,
}));

const deriveStageHintMock = vi.fn();
vi.mock("@/lib/funnel-stage.js", () => ({
  deriveStageHint: deriveStageHintMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

const registerWorkflowMock = vi.fn((fn: unknown, _options: { name: string }) => fn);
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    registerWorkflow: registerWorkflowMock,
  },
}));

const { runGuestTurnWorkflow } = await import("@/agent/run-guest-turn.js");

// Captured before beforeEach's vi.clearAllMocks() wipes it — registration
// happens exactly once, at import time.
const registrationCallArgs = registerWorkflowMock.mock.calls[0];

describe("runGuestTurnWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    touchGuestContactMock.mockResolvedValue({ ok: true });
    deriveStageHintMock.mockReturnValue(undefined);
    sendWhatsAppMessageMock.mockResolvedValue({ ok: true });
    recordMessageMock.mockResolvedValue("msg-assistant-1");
  });

  it("registers itself as a DBOS workflow named runGuestTurn", () => {
    expect(registrationCallArgs?.[0]).toEqual(expect.any(Function));
    expect(registrationCallArgs?.[1]).toEqual(expect.objectContaining({ name: "runGuestTurn" }));
  });

  it("runs the turn, records the assistant reply, touches CRM with the derived stage hint, and sends the reply via Twilio", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: "Yes, room 1 is available!" }],
    });
    deriveStageHintMock.mockReturnValue("informed");

    await runGuestTurnWorkflow({
      conversationId: "convo-1",
      phone: "whatsapp:+351920742845",
      incomingMessage: "Is room 1 free?",
      triggerMessageId: "msg-user-1",
    });

    expect(runAgentTurnMock).toHaveBeenCalledWith(
      {
        conversationId: "convo-1",
        phone: "whatsapp:+351920742845",
        incomingMessage: "Is room 1 free?",
      },
      { triggerMessageId: "msg-user-1" },
    );
    expect(recordMessageMock).toHaveBeenCalledWith(
      "convo-1",
      "assistant",
      "Yes, room 1 is available!",
      expect.any(String),
    );
    expect(touchGuestContactMock).toHaveBeenCalledWith("whatsapp:+351920742845", "informed");
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      "whatsapp:+351920742845",
      "Yes, room 1 is available!",
    );
  });

  it("falls back to a generic apology reply when the turn's last message isn't a string assistant message", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "tool", content: [] }],
    });

    await runGuestTurnWorkflow({
      conversationId: "convo-1",
      phone: "whatsapp:+351920742845",
      incomingMessage: "???",
    });

    const expectedFallback = "Sorry, I couldn't process that — please try again shortly.";
    expect(recordMessageMock).toHaveBeenCalledWith(
      "convo-1",
      "assistant",
      expectedFallback,
      expect.any(String),
    );
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      "whatsapp:+351920742845",
      expectedFallback,
    );
  });

  it("logs but does not throw when sendWhatsAppMessage fails", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: "Hello!" }],
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({
      ok: false,
      error: "Twilio rejected the number",
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runGuestTurnWorkflow({
        conversationId: "convo-1",
        phone: "whatsapp:+351920742845",
        incomingMessage: "Hi",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Twilio rejected the number"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("logs but does not throw when touchGuestContact fails", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: "Hello!" }],
    });
    touchGuestContactMock.mockResolvedValueOnce({ ok: false, error: "CRM down" });
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runGuestTurnWorkflow({
      conversationId: "convo-1",
      phone: "whatsapp:+351920742845",
      incomingMessage: "Hi",
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("CRM down"));
    consoleWarnSpy.mockRestore();
  });
});
