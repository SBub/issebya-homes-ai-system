import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the module boundary for every dependency resumeConversationWithAnswer
// touches — same "mock the shared module, not the network/LLM" approach as
// every other test in this app. graph.invoke is mocked wholesale (this is
// NOT a graph-behavior test — graph.unit.test.ts already covers that); this
// file only proves resumeConversationWithAnswer's own wiring: how it calls
// the graph, how it extracts a reply, and how it maps every failure mode to
// `{ ok: false, error }` instead of throwing.
const graphInvokeMock = vi.fn();
vi.mock("@/graph/graph.js", () => ({
  graph: { invoke: graphInvokeMock },
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
    graphInvokeMock.mockReset();
    recordMessageMock.mockReset();
    sendWhatsAppMessageMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes the graph with the trigger message as incomingMessage, sends the reply, and records it", async () => {
    graphInvokeMock.mockResolvedValueOnce({
      messages: [new AIMessage("Yes, we do have a swimming pool!")],
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({ ok: true });
    recordMessageMock.mockResolvedValueOnce("msg-assistant-1");

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result).toEqual({ ok: true });

    expect(graphInvokeMock).toHaveBeenCalledWith(
      {
        conversationId: "convo-1",
        phone: "+351920742845",
        incomingMessage: "Is there a swimming pool?",
      },
      expect.objectContaining({
        configurable: {
          conversationId: "convo-1",
          phone: "+351920742845",
          thread_id: "convo-1",
        },
        runId: expect.any(String),
      }),
    );

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

  it("returns ok:false when the graph throws", async () => {
    graphInvokeMock.mockRejectedValueOnce(new Error("graph boom"));

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
    graphInvokeMock.mockResolvedValueOnce({
      messages: [
        new AIMessage(
          "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
        ),
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

  it("returns ok:false when the last message isn't an AIMessage", async () => {
    graphInvokeMock.mockResolvedValueOnce({
      messages: [new ToolMessage({ content: "some tool result", tool_call_id: "call_1" })],
    });

    const result = await resumeConversationWithAnswer({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });

    expect(result.ok).toBe(false);
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("returns ok:false when the AIMessage content isn't a string", async () => {
    graphInvokeMock.mockResolvedValueOnce({
      messages: [new AIMessage({ content: [{ type: "text", text: "hi" }] })],
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
    graphInvokeMock.mockResolvedValueOnce({
      messages: [new AIMessage("Yes, we do have a swimming pool!")],
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
