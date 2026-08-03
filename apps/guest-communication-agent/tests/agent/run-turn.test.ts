import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Drives runAgentTurn end-to-end through its public entry point, mocking
// only the true external boundaries: Postgres (@/lib/supabase),
// telegram-router, LangSmith's Prompt Hub, and generateText itself. Tool
// declarations have no `execute` (dispatch is manual via runToolCall()), so
// the mocked generateText only needs to return { text, toolCalls, response
// }; real tool implementations (runGetPricing, runSendBookingLink,
// runEscalateToOwner) still run for real against the mocks below.
const loadContextMock = vi.fn();
vi.mock("@/agent/load-context.js", () => ({
  loadContext: loadContextMock,
}));

// checkAvailability does a real fetch() and answerPropertyQuestion a real
// embedding call, so neither is exercised here — only getPricing (pure),
// sendBookingLink, and escalateToOwner (both Supabase + telegram-router).
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
  // search-property.ts calls createClient() at module load time as a
  // transitive dependency of answerPropertyQuestion (always imported into
  // run-turn.ts's `tools` ToolSet), so this must be present even though no
  // test here calls that tool.
  createClient: vi.fn(() => ({})),
}));

const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
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

const { runAgentTurn, sanitizeReplyText } = await import("@/agent/run-turn.js");

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
    loadContextMock.mockResolvedValue({ historyMessages: [], guestContext: null });
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
  });

  it("builds the model call's system prompt string, history, then the new incoming message last", async () => {
    const history: ModelMessage[] = [
      { role: "user", content: "Hi, room 1 free?" },
      { role: "assistant", content: "Yes, in August." },
    ];
    loadContextMock.mockResolvedValue({ historyMessages: history, guestContext: null });
    generateTextMock.mockResolvedValueOnce(textResponse("Sure, here you go."));

    await runAgentTurn({
      conversationId: "convo-1",
      phone: "+3519",
      incomingMessage: "Also, is breakfast included?",
    });

    expect(loadContextMock).toHaveBeenCalledWith({ conversationId: "convo-1", phone: "+3519" });

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
    expect(result.missingInfoEscalated).toBe(false);
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
    expect(result.missingInfoEscalated).toBe(false);

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

  it("escalates instead of calling the model once MAX_AGENT_STEPS is exceeded", async () => {
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

    // Rounds 1-8 each call the model once; round 9 short-circuits to the
    // safety-net escalation without a 9th model call.
    expect(generateTextMock).toHaveBeenCalledTimes(8);
    expect(result.stepCount).toBe(9);
    expect(result.missingInfoEscalated).toBe(true);

    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "convo-cap",
        phone_number: "+351900000099",
        reason_category: "missing_info",
        reason: expect.stringContaining('Guest asked: "Is there a juicer in the kitchen?"'),
        trigger_message_id: "trigger-1",
      }),
    );
    expect(sendEscalationNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ escalationId: "esc-1", reasonCategory: "missing_info" }),
    );

    const last = result.messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toMatch(/owner/i);
  });

  it("keeps missingInfoEscalated sticky and keeps looping (getting a real, if discarded, reply) after a missing_info escalateToOwner call", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "escalateToOwner",
            input: { reason: "Guest asked about the sauna", reason_category: "missing_info" },
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

    // The loop kept going after the escalation — the model got a second
    // round and composed real text (not an early return right after the
    // tool call).
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(2);
    // Sticky: stays true even though a later round produced real text.
    expect(result.missingInfoEscalated).toBe(true);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Actually, here's the answer about the sauna!",
    });
    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: "missing_info" }),
    );
  });

  it("does not set missingInfoEscalated for wants_human/complaint escalateToOwner calls", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "escalateToOwner",
            input: { reason: "Guest wants a human", reason_category: "wants_human" },
            toolCallId: "call_esc",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Sure, the owner will reach out shortly."));

    const result = await runAgentTurn({
      conversationId: "convo-wants-human",
      phone: "+351900000003",
      incomingMessage: "I want to talk to a person",
    });

    expect(result.missingInfoEscalated).toBe(false);
    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: "wants_human" }),
    );
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
