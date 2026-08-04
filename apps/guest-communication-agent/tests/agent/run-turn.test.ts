import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Drives runAgentTurn end-to-end, mocking only the true external boundaries:
// Postgres, telegram-router, LangSmith's Prompt Hub, and generateText
// itself. Real tool implementations still run against the mocks below.
const loadMemoryMock = vi.fn();
vi.mock("@/agent/memory.js", () => ({
  loadMemory: loadMemoryMock,
}));

// checkAvailability does a real fetch() and answerPropertyQuestion a real
// embedding call, so neither is exercised here.
const mockEscSingle = vi.fn();
const mockEscSelect = vi.fn(() => ({ single: mockEscSingle }));
const mockEscInsert = vi.fn(() => ({ select: mockEscSelect }));
const mockEscEq = vi.fn();
const mockEscUpdate = vi.fn(() => ({ eq: mockEscEq }));
const mockBookingInsert = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === "escalations") return { insert: mockEscInsert, update: mockEscUpdate };
  if (table === "booking_link_requests") return { insert: mockBookingInsert };
  throw new Error(`run-turn.test.ts fromMock: unexpected table "${table}"`);
});
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
  // property-question.ts calls createClient() at module load time, so this
  // must be present even though no test here calls that tool.
  createClient: vi.fn(() => ({})),
}));

const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
}));

const recordMessageMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  recordMessage: recordMessageMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

// workflowID undefined by default (no live workflow context in these
// tests). recv defaults to resolving null (a timeout), driving
// runMissingInfo's real "owner has been notified" fallback path.
// registerWorkflow is mocked to just return the plain function, so
// runGuestTurnWorkflow can be called directly like any other async function.
const dbosRecvMock = vi.fn().mockResolvedValue(null);
const dbosSendMock = vi.fn();
const registerWorkflowMock = vi.fn((fn: unknown, _options: { name: string }) => fn);
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    get workflowID() {
      return undefined;
    },
    recv: dbosRecvMock,
    send: dbosSendMock,
    registerWorkflow: registerWorkflowMock,
  },
}));

// Mocked as a real constructable class since `new Client(...)` must keep
// working.
const pullPromptCommitMock = vi.fn();
vi.mock("langsmith", () => ({
  Client: class {
    pullPromptCommit = pullPromptCommitMock;
  },
}));

// pullSystemPromptTemplate() deserializes the pulled commit via
// @langchain/core/load's load() — mocked to return a stub template instead
// of actually deserializing anything.
const promptTemplateInvokeMock = vi.fn();
vi.mock("@langchain/core/load", () => ({
  load: vi.fn().mockResolvedValue({ invoke: promptTemplateInvokeMock }),
}));

// Only generateText is mocked — tool() and everything else "ai" exports
// stays real.
const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

// Only needs a working `.chat(modelId)` since generateText itself is mocked.
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: (modelId: string) => modelId }),
}));

const { runAgentTurn, runGuestTurnWorkflow, sanitizeReplyText } = await import(
  "@/agent/run-turn.js"
);

// Captured before beforeEach's vi.clearAllMocks() wipes it — registration
// happens exactly once, at import time.
const registrationCallArgs = registerWorkflowMock.mock.calls[0];

const SYSTEM_PROMPT_TEXT = "You are the whatsapp booking agent.";

function textResponse(text: string) {
  return {
    text,
    toolCalls: [] as unknown[],
    response: { messages: [{ role: "assistant", content: text }] as ModelMessage[] },
  };
}

// Builds a mocked generateText round result for one or more tool calls.
// response.messages only carries the assistant message with the tool-call
// parts, no tool-result message — that's built for real by run-turn.ts's
// own runToolCall() + toolResultMessage().
function toolCallResponse(
  calls: Array<{ toolName: string; input: Record<string, unknown>; toolCallId: string }>,
) {
  return {
    text: "",
    toolCalls: calls.map((call) => ({ type: "tool-call" as const, ...call })),
    response: {
      messages: [
        {
          role: "assistant" as const,
          content: calls.map((call) => ({ type: "tool-call" as const, ...call })),
        },
      ] as ModelMessage[],
    },
  };
}

describe("runAgentTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMemoryMock.mockResolvedValue({
      historyMessages: [],
      contextBlock: "No prior guest information available.",
    });
    pullPromptCommitMock.mockResolvedValue({
      manifest: {},
      owner: "test-owner",
      repo: "test-repo",
      commit_hash: "abc123",
    });
    promptTemplateInvokeMock.mockResolvedValue({
      toChatMessages: () => [{ content: SYSTEM_PROMPT_TEXT }],
    });
    mockEscSingle.mockResolvedValue({ data: { id: "esc-1" }, error: null });
    mockEscEq.mockResolvedValue({ error: null });
    mockBookingInsert.mockResolvedValue({ data: null, error: null });
    sendEscalationNudgeMock.mockResolvedValue({ ok: true, telegramMessageId: 4242 });
    recordMessageMock.mockResolvedValue("msg-assistant-1");
    sendWhatsAppMessageMock.mockResolvedValue({ ok: true });
  });

  it("builds the model call's system prompt string, history, then the new incoming message last", async () => {
    const history: ModelMessage[] = [
      { role: "user", content: "Hi, room 1 free?" },
      { role: "assistant", content: "Yes, in August." },
    ];
    loadMemoryMock.mockResolvedValue({
      historyMessages: history,
      contextBlock: "No prior guest information available.",
    });
    generateTextMock.mockResolvedValueOnce(textResponse("Sure, here you go."));

    await runAgentTurn({
      conversationId: "convo-1",
      phone: "+3519",
      incomingMessage: "Also, is breakfast included?",
    });

    expect(loadMemoryMock).toHaveBeenCalledWith({ conversationId: "convo-1", phone: "+3519" });

    const [call] = generateTextMock.mock.calls[0] as [{ system: string; messages: ModelMessage[] }];
    expect(call.system).toBe(SYSTEM_PROMPT_TEXT);
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0]).toBe(history[0]);
    expect(call.messages[1]).toBe(history[1]);
    expect(call.messages[2]).toEqual({ role: "user", content: "Also, is breakfast included?" });
  });

  it("returns a sanitized final text reply when the model calls no tools", async () => {
    generateTextMock.mockResolvedValueOnce(
      textResponse("The **Hairdryer** is in the bathroom — just ask if you need help."),
    );

    const result = await runAgentTurn({
      conversationId: "convo-1",
      phone: "+3519",
      incomingMessage: "Is there a hairdryer?",
    });

    expect(result.stepCount).toBe(1);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "The Hairdryer is in the bathroom, just ask if you need help.",
    });
  });

  it("fans out to every tool call in one round and correlates tool results by tool_call_id, then loops back to the model", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_price" },
          {
            toolName: "sendBookingLink",
            input: {
              guestName: "Ana",
              room: "room1",
              checkIn: "2026-09-01",
              checkOut: "2026-09-05",
            },
            toolCallId: "call_book",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("All set, here is your link!"));

    const result = await runAgentTurn({
      conversationId: "convo-1",
      phone: "+3519",
      incomingMessage: "Book room 1 for Ana, Sep 1-5",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(2);

    const toolMessages = result.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    const parts = toolMessages[0].content as Array<{ toolCallId: string; toolName: string }>;
    expect(parts.find((p) => p.toolCallId === "call_price")?.toolName).toBe("getPricing");
    expect(parts.find((p) => p.toolCallId === "call_book")?.toolName).toBe("sendBookingLink");

    expect(mockBookingInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "convo-1",
        phone_number: "+3519",
        guest_name: "Ana",
      }),
    );

    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "All set, here is your link!",
    });
  });

  it("stops looping once MAX_AGENT_STEPS is hit, without an extra model call or an escalation", async () => {
    // Model always responds with a tool call so the loop never produces a
    // final reply — the pathological case the step cap exists for.
    generateTextMock.mockImplementation(() =>
      toolCallResponse([
        { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_loop" },
      ]),
    );

    const result = await runAgentTurn(
      {
        conversationId: "convo-cap",
        phone: "+351900000099",
        incomingMessage: "Is there a juicer in the kitchen?",
      },
      { triggerMessageId: "trigger-1" },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(8);
    expect(result.stepCount).toBe(8);
    expect(mockEscInsert).not.toHaveBeenCalled();
    expect(sendEscalationNudgeMock).not.toHaveBeenCalled();

    const last = result.messages.at(-1);
    expect(last?.role).toBe("tool");
  });

  it("keeps looping after a missing_info tool call (a real DBOS.recv answer flows back as the tool's own result, and the model composes a real final reply in the same turn)", async () => {
    // Overrides this suite's default (resolves null, a timeout) with a real
    // answer, so runMissingInfo returns { escalated: true, answer } directly.
    dbosRecvMock.mockResolvedValueOnce("The sauna is on the ground floor.");
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "missing_info",
            input: { reason: "Guest asked about the sauna" },
            toolCallId: "call_esc",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Actually, here's the answer about the sauna!"));

    const result = await runAgentTurn({
      conversationId: "convo-sticky",
      phone: "+351900000002",
      incomingMessage: "Is there a sauna?",
    });

    // The loop kept going after the tool call — the model got a second
    // round and composed real text, not an early return.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(2);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Actually, here's the answer about the sauna!",
    });
    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: "missing_info" }),
    );

    const toolMessage = result.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as
      | Array<{ toolCallId: string; output: unknown }>
      | undefined;
    const part = parts?.find((p) => p.toolCallId === "call_esc");
    expect(part?.output).toEqual({
      type: "json",
      value: { escalated: true, answer: "The sauna is on the ground floor." },
    });
  });

  it("escalates a wants_human tool call as its own reason_category", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "wants_human",
            input: { reason: "Guest wants a human" },
            toolCallId: "call_esc",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Sure, the owner will reach out shortly."));

    await runAgentTurn({
      conversationId: "convo-wants-human",
      phone: "+351900000003",
      incomingMessage: "I want to talk to a person",
    });

    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: "wants_human" }),
    );
  });

  it("routes wants_human and sendBookingLink through the stub HITL gate (which always approves today) before running them", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "sendBookingLink",
            input: {
              guestName: "Ana",
              room: "room1",
              checkIn: "2026-09-01",
              checkOut: "2026-09-05",
            },
            toolCallId: "call_book",
          },
          {
            toolName: "wants_human",
            input: { reason: "Guest wants to speak to someone" },
            toolCallId: "call_human",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Sure thing!"));

    const result = await runAgentTurn({
      conversationId: "convo-hitl",
      phone: "+351900000010",
      incomingMessage: "Book it and also let me talk to someone",
    });

    // Both gated tools still ran to completion (their real side effects
    // fired) since the stub always approves — see run-turn.ts's
    // requestHitlApproval and NEEDS_HITL.
    expect(mockBookingInsert).toHaveBeenCalled();
    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: "wants_human" }),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("sendBookingLink"));
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("wants_human"));
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Sure thing!" });

    consoleWarnSpy.mockRestore();
  });

  it("does not route getPricing through the stub HITL gate (only wants_human/sendBookingLink are gated)", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_price" },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Got it, here is the price."));

    await runAgentTurn({
      conversationId: "convo-no-hitl",
      phone: "+351900000011",
      incomingMessage: "How much is room 1?",
    });

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  // generateText is mocked wholesale, so nothing stops it from "returning" a
  // tool call for a name outside the real `tools` ToolSet — runToolCall()'s
  // default case is what guards against that.
  it("throws for an unrecognized tool call name", async () => {
    generateTextMock.mockResolvedValueOnce(
      toolCallResponse([{ toolName: "bogusTool", input: {}, toolCallId: "call_bogus" }]),
    );

    await expect(
      runAgentTurn({
        conversationId: "convo-bogus",
        phone: "+351900000005",
        incomingMessage: "Whatever",
      }),
    ).rejects.toThrow(/unknown tool name.*bogusTool/i);
  });
});

describe("sanitizeReplyText", () => {
  it("replaces em dashes with a comma and strips bold/italic asterisks without deleting the wrapped text", () => {
    expect(sanitizeReplyText("Room 1 is available — book now")).toBe(
      "Room 1 is available, book now",
    );
    expect(sanitizeReplyText("**Hairdryer** and *towels* included")).toBe(
      "Hairdryer and towels included",
    );
  });
});

// The DBOS-wrapped delivery orchestrator: drives the real runAgentTurn (via
// this suite's existing mocks — loadMemory, generateText, etc.), then
// records the reply and sends it proactively. No CRM touch step — see the
// CRM removal in this app's history.
describe("runGuestTurnWorkflow", () => {
  it("registers itself as a DBOS workflow named runGuestTurn", () => {
    expect(registrationCallArgs?.[0]).toEqual(expect.any(Function));
    expect(registrationCallArgs?.[1]).toEqual(expect.objectContaining({ name: "runGuestTurn" }));
  });

  it("runs the turn, records the assistant reply, and sends it via Twilio", async () => {
    generateTextMock.mockResolvedValueOnce(textResponse("Yes, room 1 is available!"));

    await runGuestTurnWorkflow({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "Is room 1 free?",
      triggerMessageId: "msg-user-1",
    });

    expect(recordMessageMock).toHaveBeenCalledWith(
      "convo-1",
      "assistant",
      "Yes, room 1 is available!",
      expect.any(String),
    );
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      "+351920742845",
      "Yes, room 1 is available!",
    );
  });

  it("falls back to a generic apology reply when the turn's last message isn't a string assistant message", async () => {
    // Model always responds with a tool call, so the loop never produces a
    // final text reply — same step-cap shape as the runAgentTurn suite above.
    generateTextMock.mockImplementation(() =>
      toolCallResponse([
        { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_loop" },
      ]),
    );

    await runGuestTurnWorkflow({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "???",
    });

    const expectedFallback = "Sorry, I couldn't process that — please try again shortly.";
    expect(recordMessageMock).toHaveBeenCalledWith(
      "convo-1",
      "assistant",
      expectedFallback,
      expect.any(String),
    );
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith("+351920742845", expectedFallback);
  });

  it("logs but does not throw when sendWhatsAppMessage fails", async () => {
    generateTextMock.mockResolvedValueOnce(textResponse("Hello!"));
    sendWhatsAppMessageMock.mockResolvedValueOnce({
      ok: false,
      error: "Twilio rejected the number",
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runGuestTurnWorkflow({
        conversationId: "convo-1",
        phone: "+351920742845",
        incomingMessage: "Hi",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Twilio rejected the number"),
    );
    consoleErrorSpy.mockRestore();
  });
});
