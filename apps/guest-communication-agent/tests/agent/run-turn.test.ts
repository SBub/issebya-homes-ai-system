import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

// runAgentTurn (@/agent/run-turn.ts) replaced the old LangGraph StateGraph
// (load_context -> agent <-> tool nodes -> END) with a single plain
// tool-calling loop, and (as of the LangChain -> Vercel AI SDK migration)
// its model calls now go through "ai"'s generateText instead of
// @langchain/openai's ChatOpenAI. These tests drive that loop end-to-end
// through its one public entry point rather than reaching into private
// helpers, mocking only the true external boundaries: Postgres (via
// @/lib/supabase), telegram-router, LangSmith's Prompt Hub, and the model
// call itself (generateText, mocked the same "mock the module boundary, not
// the network" way tests/api/escalations/[id]/resolve/route.test.ts mocks
// ai's embed()). Every tool in src/agent/tools/*.ts is now a schema-only
// `tool()` declaration with no `execute` — dispatch is manual, done by
// run-turn.ts's own runToolCall() — so this file's mocked generateText
// implementation only ever needs to return the shape a real generateText
// call would ({ text, toolCalls, response }); it never calls a tool's
// `execute` itself (there is none). Real tool implementations
// (runGetPricing, runSendBookingLink, runEscalateToOwner) still run for
// real, exercised by run-turn.ts's real runToolCall() dispatch against the
// mocked Supabase/telegram-router boundaries below — same effective
// coverage as before, just exercised through the real dispatch path instead
// of this test file calling `execute` itself.
const loadContextMock = vi.fn();
vi.mock("@/agent/load-context.js", () => ({
  loadContext: loadContextMock,
}));

// checkAvailability (@/agent/tools/availability.ts) does a real fetch() and
// answerPropertyQuestion (@/agent/tools/property-question.ts) does a real
// embedding call — neither tool is exercised by these tests, only
// getPricing (pure), sendBookingLink (Supabase insert), and escalateToOwner
// (Supabase insert/update + telegram-router), all of which route through
// the mocks below.
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
  // ../../tools/search-property.ts imports createClient() at module load
  // time (its own singleton pattern) as a transitive dependency of
  // answerPropertyQuestion, which run-turn.ts always imports into its
  // module-level `tools` ToolSet — must be present here even though no test
  // below actually calls that tool.
  createClient: vi.fn(() => ({})),
}));

const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
}));

// Same "mock as a real constructable class" convention as
// tests/api/messages/[messageId]/feedback/route.test.ts's own langsmith
// Client mock — `new Client(...)` must keep working.
const pullPromptCommitMock = vi.fn();
vi.mock("langsmith", () => ({
  Client: class {
    pullPromptCommit = pullPromptCommitMock;
  },
}));

// pullSystemPromptTemplate() deserializes the pulled commit's manifest via
// @langchain/core/load's load() into a real ChatPromptTemplate — mocked here
// so it returns a stub template instead of actually deserializing anything.
// This is the one narrow @langchain/core usage the migration kept (see
// run-turn.ts's own doc comment) — everything downstream of
// promptTemplate.invoke(...).toChatMessages()[0].content is a plain string.
const promptTemplateInvokeMock = vi.fn();
vi.mock("@langchain/core/load", () => ({
  load: vi.fn().mockResolvedValue({ invoke: promptTemplateInvokeMock }),
}));

// Only generateText is mocked — tool()/everything else "ai" exports stays
// real, since run-turn.ts's own module-level `tools` ToolSet and every
// tools/*.ts file build real AI SDK tool objects with it.
const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

// createOpenAI's return value only needs a working `.chat(modelId)` for
// run-turn.ts's module-level `model` — its result is never actually sent
// anywhere since generateText itself is mocked above.
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

function emptyResponse() {
  return { text: "", toolCalls: [] as unknown[], response: { messages: [] as ModelMessage[] } };
}

// Builds a mocked generateText round result for one or more tool calls —
// just the { text, toolCalls, response } shape a real generateText call
// returns when the model requests tool calls but none of `tools` has an
// `execute` (see this file's own header comment). response.messages only
// ever carries the assistant message with the tool-call parts, no tool-role
// result message: that's built for real by run-turn.ts's own runToolCall()
// dispatch + toolResultMessage(), exercised against this file's mocked
// Supabase/telegram-router boundaries, not faked here.
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
    // Model always responds with a (harmless, pure) tool call so the loop
    // keeps running round after round without ever producing a final reply
    // — the same "pathological, won't stop" case the step cap exists for.
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

    // MAX_AGENT_STEPS is 8: rounds 1-8 each call the model once (8 calls
    // total); round 9 sees stepCount (9) > 8 and short-circuits straight to
    // the safety-net escalation without a 9th model call — a clean
    // resolution with exactly 8 model calls is itself proof of that.
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

  it("escalates as missing_info after two consecutive empty model replies in the same round", async () => {
    generateTextMock.mockResolvedValueOnce(emptyResponse()).mockResolvedValueOnce(emptyResponse());

    const result = await runAgentTurn({
      conversationId: "convo-empty",
      phone: "+351900000001",
      incomingMessage: "Is there a swimming pool?",
    });

    // Both the initial call and its one retry happen within round 1 — the
    // step cap doesn't fire, this is the separate empty-reply safety net.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(1);
    expect(result.missingInfoEscalated).toBe(true);

    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "convo-empty",
        reason_category: "missing_info",
        reason: expect.stringContaining('Guest asked: "Is there a swimming pool?"'),
      }),
    );
    const last = result.messages.at(-1);
    expect(last?.content).toMatch(/owner/i);
  });

  it("recovers without escalating when the model's empty reply is followed by a real one on retry", async () => {
    generateTextMock
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(textResponse("Yes, we have a pool!"));

    const result = await runAgentTurn({
      conversationId: "convo-retry-ok",
      phone: "+351900000001",
      incomingMessage: "Is there a swimming pool?",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(1);
    expect(result.missingInfoEscalated).toBe(false);
    expect(mockEscInsert).not.toHaveBeenCalled();
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Yes, we have a pool!" });
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

    // The loop kept going after the missing_info escalation fired — the
    // model got a second round and composed real text, exactly like the old
    // graph's tool-node -> agent edge (not an early return right after the
    // tool call).
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(2);
    // Sticky: stays true even though a later round produced real text —
    // NOT reset back to false by the normal terminal-round return.
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

  // The old LangChain-based loop had its own findToolByName()/invokeTool()
  // step that threw its own error for an unknown tool name. That guard
  // briefly became moot once dispatch moved entirely inside AI SDK's
  // generateText (every tool had its own `execute`), but is relevant again
  // now that run-turn.ts's runToolCall() owns dispatch itself — restoring
  // the equivalent test here. generateText is mocked wholesale in this
  // file, so nothing stops it from "returning" a tool call for a name
  // outside the real `tools` ToolSet the way a misbehaving/adversarial model
  // response in principle could; runToolCall()'s default case is what
  // guards against that.
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
