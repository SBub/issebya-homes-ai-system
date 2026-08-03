import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// runAgentTurn is mocked wholesale — this is not an agent-behavior test
// (tests/agent/run-turn.test.ts covers that); this file only proves
// resumeConversationWithAnswer's own wiring: how it calls the agent, how it
// extracts a reply, and how it maps every failure mode to
// `{ ok: false, error }` instead of throwing.
const runAgentTurnMock = vi.fn();
vi.mock("@/agent/run-turn.js", () => ({
  runAgentTurn: runAgentTurnMock,
}));

const recordMessageMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  recordMessage: recordMessageMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

const { resumeConversationWithAnswer } = await import("@/lib/resume-conversation.js");

describe("resumeConversationWithAnswer", () => {
  beforeEach(() => {
    runAgentTurnMock.mockReset();
    recordMessageMock.mockReset();
    sendWhatsAppMessageMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes runAgentTurn with the trigger message as incomingMessage, sends the reply, and records it", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: "Yes, we do have a swimming pool!" }],
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({ ok: true });
    recordMessageMock.mockResolvedValueOnce("msg-assistant-1");

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result).toEqual({ ok: true });

    expect(runAgentTurnMock).toHaveBeenCalledWith({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "Is there a swimming pool?",
    });

    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      "+351920742845",
      "Yes, we do have a swimming pool!",
    );
    expect(recordMessageMock).toHaveBeenCalledWith(
      "convo-1",
      "assistant",
      "Yes, we do have a swimming pool!",
      expect.any(String),
    );
  });

  it("returns ok:false when runAgentTurn throws", async () => {
    runAgentTurnMock.mockRejectedValueOnce(new Error("graph boom"));

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result).toEqual({ ok: false, error: "graph boom" });
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
    expect(recordMessageMock).not.toHaveBeenCalled();
  });

  it("returns ok:false and does not send/record when the re-invoked turn escalates again as missing_info", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [
        {
          role: "assistant",
          content:
            "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
        },
      ],
      missingInfoEscalated: true,
    });

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result).toEqual({
      ok: false,
      error: "Graph escalated again during re-invocation instead of producing a real answer",
    });
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
    expect(recordMessageMock).not.toHaveBeenCalled();
  });

  it('returns ok:false when the last message isn\'t a role: "assistant" message', async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "getPricing",
              output: { type: "text", value: "result" },
            },
          ],
        },
      ],
    });

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result.ok).toBe(false);
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("returns ok:false when the assistant message content isn't a string", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: [{ type: "text", text: "hi" }] }],
    });

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result.ok).toBe(false);
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("returns ok:false with the Twilio error, and does not record the message, when the send fails", async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: "Yes, we do have a swimming pool!" }],
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({
      ok: false,
      error: "Twilio rejected the number",
    });

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result).toEqual({ ok: false, error: "Twilio rejected the number" });
    expect(recordMessageMock).not.toHaveBeenCalled();
  });
});
