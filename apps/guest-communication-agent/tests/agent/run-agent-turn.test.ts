import { BraintrustSpanProcessor } from "@braintrust/otel";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ModelMessage } from "ai";
import type { GetStepTools } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// tracing.ts's real withTurnSpan/tracer stay real in this suite (see the
// updateSpanIOMock comment below), but with no OTel SDK wired up (that's
// instrumentation.ts's job, only invoked by the real Next.js runtime), the
// default global TracerProvider is a no-op — span.setAttribute calls happen
// but land nowhere observable. Registering a real, in-memory-only
// BasicTracerProvider here (once, for this whole test file) lets the
// send_booking_link span-tagging test below inspect the actual attributes a
// real span ends up with, without needing to touch Braintrust or any
// network. trace.getTracer() inside tracing.ts resolves this lazily on each
// span-emitting call (it's a ProxyTracer), so registering after that
// module's already been imported still takes effect.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// Drives runAgentTurn end-to-end, mocking only the true external boundaries:
// Postgres, telegram-router, Braintrust's prompt store, and generateText
// itself. Real tool implementations still run against the mocks below.
const loadMemoryMock = vi.fn();
vi.mock("@/agent/memory.js", () => ({
  loadMemory: loadMemoryMock,
}));

// check_availability does a real fetch() and answer_property_question a real
// embedding call, so neither is exercised here. No more escalations table —
// requestOwnerNudge talks to telegram-router only, not Supabase.
// send_booking_link is a pure stub now (no DB write). The one real caller left
// is tracing.ts's recordMissingInfoTraceAnchor (via requestMissingInfoApproval,
// on every missing_info dispatch) — insert() always resolves cleanly here so
// that best-effort write's own try/catch never has anything to report; the
// write itself isn't asserted on in this file (see the owner-nudges answer
// route's own test file for the read side of this same table).
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  })),
  // property-question.ts calls createClient() at module load time, so this
  // must be present even though no test here calls that tool.
  createClient: vi.fn(() => ({})),
}));

const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

// pending_owner_decisions bookkeeping — real callers are approval-gate.ts's
// requestApprovalGate (real code in this suite, only spied — see
// requestApprovalGateSpy below) and missing-info.ts's own
// requestMissingInfoApproval. Mocked at this module boundary, same "mock the
// module's exported external-call function directly" style used elsewhere.
const insertPendingOwnerDecisionMock = vi.fn();
const resolvePendingOwnerDecisionByCorrelationIdMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  insertPendingOwnerDecision: insertPendingOwnerDecisionMock,
  resolvePendingOwnerDecisionByCorrelationId: resolvePendingOwnerDecisionByCorrelationIdMock,
}));

// run_code's real dispatch (runRunCode -> sandbox.ts's runInSandbox) talks to
// a real Vercel Sandbox (a remote Firecracker VM) — mocked at its one true
// external boundary, Sandbox.create, so the "run_code soft-fails" test below
// can drive runInSandbox's real catch-block branch (`{ ok: false, error,
// logs: [] }`, see sandbox.ts) without any real provisioning.
//
// Sandbox.create() itself is awaited OUTSIDE runInSandbox's own try/catch
// (see sandbox.ts) — rejecting it directly would be a genuine uncaught
// throw, not the `{ ok: false, error }` soft-fail shape this fix is about.
// The default mock below instead resolves Sandbox.create with a fake sandbox
// whose runCommand() rejects, which IS inside the try/catch and so exercises
// the real soft-fail branch.
const sandboxCreateMock = vi.fn();
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: (...args: unknown[]) => sandboxCreateMock(...args) },
}));

// tracing.ts's real withTurnSpan stays real (it's pure OTel API calls, no
// network) so run-agent-turn.ts's "start-trace"/model/tool spans still
// exercise real span-id generation — only updateSpanIO (a real fetch() to
// Braintrust's REST API) is mocked, the same "mock the module's exported
// external-call function directly" style used for sendOwnerNudge etc. above.
const updateSpanIOMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  return { ...actual, updateSpanIO: updateSpanIOMock };
});

// approval-gate.ts's requestApprovalGate stays real (it's what actually
// sends the nudge and drives step.waitForEvent) — spied, not replaced, so
// the send_booking_link reparenting tests below can assert on the real
// `traceAnchor` param requestSendBookingLinkApproval actually passed it,
// since real parent/child span linkage isn't observable in this harness (see
// the "fans out" test's own comment for why).
const requestApprovalGateSpy = vi.fn();
vi.mock("@/agent/tools/approval-gate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/tools/approval-gate.js")>();
  return {
    ...actual,
    requestApprovalGate: (params: Parameters<typeof actual.requestApprovalGate>[0]) => {
      requestApprovalGateSpy(params);
      return actual.requestApprovalGate(params);
    },
  };
});

// run-agent-turn.ts's loadPrompt({ slug: SYSTEM_PROMPT_SLUG, ... }) call —
// mocked to return a stub Prompt whose build() returns a fixed messages
// array, instead of actually hitting Braintrust.
const loadPromptMock = vi.fn();
vi.mock("braintrust", () => ({
  loadPrompt: loadPromptMock,
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

const { runAgentTurn, sanitizeReplyText } = await import("@/agent/run-agent-turn.js");

const SYSTEM_PROMPT_TEXT = "You are the whatsapp booking agent.";

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

// Hand-rolled Inngest step mock — mirrors how @dbos-inc/dbos-sdk used to be
// hand-mocked in this suite. step.run immediately invokes its callback
// (matching how a real step.run behaves from the caller's perspective once
// memoized state doesn't short-circuit it) rather than pulling in
// @inngest/test's heavier InngestTestEngine harness, since run-agent-turn.ts
// takes `step` as a plain explicit parameter instead of an ambient import —
// a plain mock object is enough.
type StepTools = GetStepTools<typeof inngest>;

// Only `run`/`waitForEvent` are exercised by real code here — the rest of
// the real StepTools surface (sendEvent, sleep, ai, ...) is cast away rather
// than stubbed out, since nothing under test calls it.
function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    waitForEvent: vi.fn(),
  } as unknown as StepTools & {
    run: ReturnType<typeof vi.fn>;
    waitForEvent: ReturnType<typeof vi.fn>;
  };
}

function textResponse(text: string) {
  return {
    text,
    toolCalls: [] as unknown[],
    response: { messages: [{ role: "assistant", content: text }] as ModelMessage[] },
  };
}

// Builds a mocked generateText round result for one or more tool calls.
// response.messages only carries the assistant message with the tool-call
// parts, no tool-result message — that's built for real by
// run-agent-turn.ts's own runAgentTurn loop + toolResultMessage().
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

// A round where the model produced neither text nor a tool call — the
// degenerate response modelTurn's retry loop exists for. reasoningText/
// content/warnings/responseBody mirror generateText's real GenerateTextResult
// shape — content defaults to [] (real generateText always returns an array,
// even empty) since a real occurrence showed reasoningText alone doesn't
// explain the empty result either; responseBody defaults to undefined,
// matching a real occurrence with no body captured.
function emptyResponse(
  finishReason: string,
  reasoningText?: string,
  content: unknown[] = [],
  warnings?: unknown[],
  responseBody?: unknown,
) {
  return {
    text: "",
    toolCalls: [] as unknown[],
    response: { messages: [] as ModelMessage[], body: responseBody },
    finishReason,
    reasoningText,
    content,
    warnings,
  };
}

describe("runAgentTurn", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    step = makeStepMock();
    // waitForEvent defaults to resolving null (a timeout), driving
    // requestMissingInfoApproval's real "owner has been notified" fallback
    // path.
    step.waitForEvent.mockResolvedValue(null);
    loadMemoryMock.mockResolvedValue({
      historyMessages: [],
      memoryMessage: null,
    });
    loadPromptMock.mockResolvedValue({
      build: () => ({ messages: [{ role: "system", content: SYSTEM_PROMPT_TEXT }] }),
    });
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
    // Resolves to a fake sandbox whose runCommand() rejects — runInSandbox's
    // own catch block (inside its try, unlike Sandbox.create itself) turns
    // that into a `{ ok: false, error, logs: [] }` soft-fail (see
    // sandbox.ts), which is exactly the shape the run_code soft-fail test
    // below exercises. No test here drives run_code's happy path, so there's
    // no successful case this default would need to override.
    sandboxCreateMock.mockResolvedValue({
      writeFiles: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockRejectedValue(new Error("sandbox unavailable in test")),
      stop: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("builds the model call's system prompt string, then uses historyMessages as-is with no extra append", async () => {
    // historyMessages already ends with this turn's incoming guest message —
    // the webhook route records it to whatsapp_messages before the turn ever
    // starts, so loadMemory's own DB read (real code, mocked wholesale here)
    // always returns it as the last row. run-agent-turn.ts must not append
    // incomingMessage a second time on top of this (that was the duplicate-
    // message bug this fixes).
    const history: ModelMessage[] = [
      { role: "user", content: "Hi, room 1 free?" },
      { role: "assistant", content: "Yes, in August." },
      { role: "user", content: "Also, is breakfast included?" },
    ];
    loadMemoryMock.mockResolvedValue({
      historyMessages: history,
      memoryMessage: null,
    });
    generateTextMock.mockResolvedValueOnce(textResponse("Sure, here you go."));

    await runAgentTurn(
      {
        conversationId: "convo-1",
        phone: "+3519",
        incomingMessage: "Also, is breakfast included?",
      },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    // loadMemory no longer takes a traceAnchor — it never opens a span of
    // its own now (no LLM call, no write), unlike foldMemory.
    expect(loadMemoryMock).toHaveBeenCalledWith({
      conversationId: "convo-1",
      phone: "+3519",
    });

    const [call] = generateTextMock.mock.calls[0] as [{ system: string; messages: ModelMessage[] }];
    expect(call.system).toBe(SYSTEM_PROMPT_TEXT);
    // No guest-memory-derived text substituted into the system string —
    // loadMemory returned memoryMessage: null here, and `system` is a fixed
    // stub with nothing memory-shaped in it in the first place.
    expect(call.system).not.toContain("preferences");
    // Exactly historyMessages, same array reference elements, in order — not
    // historyMessages plus a fourth, duplicate user message, and no
    // memoryMessage prepended since loadMemory returned null.
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0]).toBe(history[0]);
    expect(call.messages[1]).toBe(history[1]);
    expect(call.messages[2]).toBe(history[2]);
  });

  it("prepends memoryMessage ahead of historyMessages as its own assistant-role message when loadMemory returns one", async () => {
    const history: ModelMessage[] = [
      { role: "user", content: "Hi, room 1 free?" },
      { role: "assistant", content: "Yes, in August." },
    ];
    const memoryMessage: ModelMessage = {
      role: "assistant",
      content:
        "User preferences:\nGuest is vegetarian.\n\n" +
        "Summary of earlier conversation:\nAsked about check-in time.",
    };
    loadMemoryMock.mockResolvedValue({ historyMessages: history, memoryMessage });
    generateTextMock.mockResolvedValueOnce(textResponse("Sure, here you go."));

    await runAgentTurn(
      {
        conversationId: "convo-1",
        phone: "+3519",
        incomingMessage: "Also, is breakfast included?",
      },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const [call] = generateTextMock.mock.calls[0] as [{ system: string; messages: ModelMessage[] }];
    // memoryMessage is its own message, first in the array, role
    // "assistant" (not "system" — see memory.ts's buildMemoryMessage
    // comment) — followed by historyMessages unchanged.
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0]).toBe(memoryMessage);
    expect(call.messages[0].role).toBe("assistant");
    expect(call.messages[1]).toBe(history[0]);
    expect(call.messages[2]).toBe(history[1]);
    // Never substituted into the system prompt string.
    expect(call.system).toBe(SYSTEM_PROMPT_TEXT);
    expect(call.system).not.toContain("vegetarian");
  });

  it("returns a sanitized final text reply when the model calls no tools", async () => {
    generateTextMock.mockResolvedValueOnce(
      textResponse("The **Hairdryer** is in the bathroom — just ask if you need help."),
    );

    const result = await runAgentTurn(
      {
        conversationId: "convo-1",
        phone: "+3519",
        incomingMessage: "Is there a hairdryer?",
      },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(result.stepCount).toBe(1);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "The Hairdryer is in the bathroom, just ask if you need help.",
    });
  });

  it("retries a model round that returns empty text and no tool calls, using the retry's reply once it succeeds", async () => {
    generateTextMock
      .mockResolvedValueOnce(emptyResponse("stop", "Let me think about pets..."))
      .mockResolvedValueOnce(textResponse("Sure, small pets are welcome!"));

    const result = await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-retry", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    // Two generateText calls, but one reasoning round from step.run's
    // perspective — the retry happens inside modelTurn's own step, not as an
    // extra "model-N" step.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(1);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Sure, small pets are welcome!",
    });

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(chatSpan?.events).toContainEqual(
      expect.objectContaining({
        name: "gen_ai.retry",
        attributes: {
          attempt: 1,
          finishReason: "stop",
          reasoningText: "Let me think about pets...",
          content: "[]",
          warnings: "(none)",
          responseBody: "(none captured)",
        },
      }),
    );
  });

  it("captures a non-empty content array on a retry event, even when reasoningText is also empty", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        emptyResponse("stop", undefined, [{ type: "tool-error", toolName: "get_pricing" }]),
      )
      .mockResolvedValueOnce(textResponse("Sure, small pets are welcome!"));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-retry-content", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.events).toContainEqual(
      expect.objectContaining({
        name: "gen_ai.retry",
        attributes: {
          attempt: 1,
          finishReason: "stop",
          reasoningText: "(none captured)",
          content: JSON.stringify([{ type: "tool-error", toolName: "get_pricing" }]),
          warnings: "(none)",
          responseBody: "(none captured)",
        },
      }),
    );
  });

  it("captures provider warnings on a retry event when present", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        emptyResponse("stop", undefined, [], [{ type: "unsupported-setting", setting: "tools" }]),
      )
      .mockResolvedValueOnce(textResponse("Sure, small pets are welcome!"));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-retry-warnings", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.events).toContainEqual(
      expect.objectContaining({
        name: "gen_ai.retry",
        attributes: {
          attempt: 1,
          finishReason: "stop",
          reasoningText: "(none captured)",
          content: "[]",
          warnings: JSON.stringify([{ type: "unsupported-setting", setting: "tools" }]),
          responseBody: "(none captured)",
        },
      }),
    );
  });

  it("falls back to a placeholder retry event value when the empty attempt captured no reasoning text", async () => {
    generateTextMock
      .mockResolvedValueOnce(emptyResponse("stop"))
      .mockResolvedValueOnce(textResponse("Sure, small pets are welcome!"));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-retry-no-reasoning", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.events).toContainEqual(
      expect.objectContaining({
        name: "gen_ai.retry",
        attributes: {
          attempt: 1,
          finishReason: "stop",
          reasoningText: "(none captured)",
          content: "[]",
          warnings: "(none)",
          responseBody: "(none captured)",
        },
      }),
    );
  });

  it("captures the raw response body on a retry event when present", async () => {
    const rawBody = { id: "gen-123", provider: "StreamLake", choices: [] };
    generateTextMock
      .mockResolvedValueOnce(emptyResponse("stop", undefined, [], undefined, rawBody))
      .mockResolvedValueOnce(textResponse("Sure, small pets are welcome!"));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-retry-body", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.events).toContainEqual(
      expect.objectContaining({
        name: "gen_ai.retry",
        attributes: {
          attempt: 1,
          finishReason: "stop",
          reasoningText: "(none captured)",
          content: "[]",
          warnings: "(none)",
          responseBody: JSON.stringify(rawBody),
        },
      }),
    );
  });

  it("gives up after 3 empty attempts, falls back to the generic apology reply, marks the span failed, and captures the final attempt's reasoning text/content/warnings/raw body as real attributes", async () => {
    const rawBody = { id: "gen-123", provider: "StreamLake", choices: [] };
    generateTextMock.mockImplementation(() =>
      emptyResponse(
        "stop",
        "Still thinking about whether cats count as pets...",
        [{ type: "tool-error", toolName: "get_pricing" }],
        [{ type: "unsupported-setting", setting: "tools" }],
        rawBody,
      ),
    );

    const result = await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-empty", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Sorry, I couldn't process that — please try again shortly.",
    });

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(chatSpan?.attributes["gen_ai.response.reasoning_text"]).toBe(
      "Still thinking about whether cats count as pets...",
    );
    expect(chatSpan?.attributes["gen_ai.response.content"]).toBe(
      JSON.stringify([{ type: "tool-error", toolName: "get_pricing" }]),
    );
    expect(chatSpan?.attributes["gen_ai.response.warnings"]).toBe(
      JSON.stringify([{ type: "unsupported-setting", setting: "tools" }]),
    );
    expect(chatSpan?.attributes["gen_ai.response.raw_body"]).toBe(JSON.stringify(rawBody));
  });

  it("doesn't set the reasoning_text/warnings/raw_body attributes when the final failed attempt captured none, but always sets content even when empty", async () => {
    generateTextMock.mockImplementation(() => emptyResponse("stop"));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-empty-no-reasoning", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan?.attributes["gen_ai.response.reasoning_text"]).toBeUndefined();
    expect(chatSpan?.attributes["gen_ai.response.warnings"]).toBeUndefined();
    expect(chatSpan?.attributes["gen_ai.response.raw_body"]).toBeUndefined();
    expect(chatSpan?.attributes["gen_ai.response.content"]).toBe("[]");
  });

  it("does not retry a content-filter finish, even with attempts remaining", async () => {
    generateTextMock.mockResolvedValueOnce(emptyResponse("content-filter"));

    const result = await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "Can I bring a cat?" },
      { correlationId: "corr-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Sorry, I couldn't process that — please try again shortly.",
    });
  });

  it("wraps each model round and every real tool call in step.run for durability", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "get_pricing", input: { room: "room1" }, toolCallId: "call_price" },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Here's the price."));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "How much is room 1?" },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("model-1");
    expect(stepIds).toContain("tool-get_pricing");
    expect(stepIds).toContain("model-2");
  });

  it("fans out to every tool call in one round and correlates tool results by tool_call_id, then loops back to the model", async () => {
    // send_booking_link now genuinely suspends on step.waitForEvent, via
    // run-agent-turn.ts's NEEDS_APPROVAL switch + approval-gate.ts's
    // requestApprovalGate — resolve it approved so this test can still
    // assert on a real { url } tool result and a real final reply.
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "get_pricing", input: { room: "room1" }, toolCallId: "call_price" },
          {
            toolName: "send_booking_link",
            input: {
              guestName: "Ana",
              email: "ana@example.com",
              room: "room1",
              checkIn: "2026-09-01",
              checkOut: "2026-09-05",
            },
            toolCallId: "call_book",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("All set, here is your link!"));

    const result = await runAgentTurn(
      {
        conversationId: "convo-1",
        phone: "+3519",
        incomingMessage: "Book room 1 for Ana, Sep 1-5",
      },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(2);

    const toolMessages = result.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    const parts = toolMessages[0].content as Array<{
      toolCallId: string;
      toolName: string;
      output: unknown;
    }>;
    expect(parts.find((p) => p.toolCallId === "call_price")?.toolName).toBe("get_pricing");
    expect(parts.find((p) => p.toolCallId === "call_book")?.toolName).toBe("send_booking_link");
    expect(parts.find((p) => p.toolCallId === "call_book")?.output).toEqual({
      type: "json",
      value: { url: expect.stringContaining("/booking/room1?") },
    });

    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "All set, here is your link!",
    });

    // send_booking_link is one of NEEDS_APPROVAL's two tools — its approval
    // half creates a "hitl.send_booking_link" GATE span FIRST, before
    // requestApprovalGate ever runs, so "hitl.send_booking_link.nudge"
    // (opened inside approval-gate.ts's requestApprovalGate) nests as this
    // gate span's real child, not its sibling. Literal parent/child span
    // linkage (ReadableSpan.parentSpanContext.spanId) can't actually be
    // asserted in this vitest environment — no real AsyncLocalStorage-based
    // ContextManager is registered here (only instrumentation.ts registers
    // one, for the real Next.js runtime), so context.with() silently no-ops
    // and every span gets its own independently-generated trace id
    // regardless of the anchor passed in (documented harness limitation, see
    // docs/braintrust-online-eval-testing.md section 6k). Asserting the real
    // `traceAnchor` param requestApprovalGate was actually called with
    // (below, via requestApprovalGateSpy) is the strongest same-harness
    // proof of correct reparenting available instead.
    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link");
    expect(hitlSpan).toBeDefined();
    expect(requestApprovalGateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "send_booking_link",
        traceAnchor: {
          traceId: TEST_TRACE_ANCHOR.traceId,
          spanId: hitlSpan?.spanContext().spanId,
        },
      }),
    );

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link.nudge");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["send_booking_link"]);

    expect(hitlSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({
        guestName: "Ana",
        email: "ana@example.com",
        room: "room1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-05",
      }),
    );
    expect(hitlSpan?.attributes["braintrust.input"]).toBe(hitlSpan?.attributes["gca.tool.input"]);

    // The real execution span is a SEPARATE span from the gate span above —
    // created fresh only once approved (by runSendBookingLink, via
    // run-tool.ts's runTool), a sibling of the gate span under the turn, not
    // its child. Real output is known at creation time now (same one-shot
    // shape every plain tool already has), so it's a real span attribute,
    // never a retroactive updateSpanIO patch — that patch mechanism is only
    // ever used by the gate span, and only on a not-approved outcome (not
    // exercised on this approved path).
    const bookingExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(bookingExecSpan).toBeDefined();
    expect(bookingExecSpan?.attributes["gen_ai.tool.name"]).toBe("send_booking_link");
    expect(bookingExecSpan?.attributes["gca.tool.output"]).toEqual(
      expect.stringContaining("/booking/room1?"),
    );
    expect(updateSpanIOMock).not.toHaveBeenCalled();

    // get_pricing isn't send_booking_link — its own span must not pick up the tag.
    const pricingSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.get_pricing");
    expect(pricingSpan?.attributes["braintrust.tags"]).toBeUndefined();

    // send_booking_link IS a real "hitl-send_booking_link" step now (the
    // gate-span-creation step, created before the approval wait) — it's
    // dispatched via the NEEDS_APPROVAL branch, not the generic runTool path
    // directly. Once approved, runSendBookingLink's own one-shot
    // "tool-send_booking_link" step runs too — no more separate execute-/
    // update-*-trace-io steps for the execution half, since real output is
    // known at span-creation time now.
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("hitl-send_booking_link");
    expect(stepIds).toContain("tool-send_booking_link");
    expect(stepIds).not.toContain("execute-send_booking_link");
    expect(stepIds).not.toContain("update-send_booking_link-trace-io");

    // The approval decision itself is independently visible too — nested
    // under the gate span in a real trace (see the requestApprovalGateSpy
    // assertion above for why that's asserted via the real traceAnchor param
    // instead of literal span linkage here).
    const decisionSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link.decision");
    expect(decisionSpan?.attributes["gca.approval.decision"]).toBe("approved");

    // pending_owner_decisions bookkeeping: recorded once the nudge is
    // confirmed sent (before the wait), with the model's own real tool-call
    // args as `context` (so a later manual-resolve action can rebuild this
    // exact booking link — see approval-gate.ts's requestApprovalGate), then
    // resolved "approved" once the real decision comes back.
    expect(insertPendingOwnerDecisionMock).toHaveBeenCalledWith({
      correlationId: "corr-1",
      toolName: "send_booking_link",
      conversationId: "convo-1",
      phone: "+3519",
      reason: expect.stringContaining("Ana"),
      context: {
        guestName: "Ana",
        email: "ana@example.com",
        room: "room1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-05",
      },
    });
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-1",
      "approved",
    );
  });

  it("stops looping once MAX_AGENT_STEPS is hit, without an extra model call or an owner nudge", async () => {
    // Model always responds with a tool call so the loop never produces a
    // final reply — the pathological case the step cap exists for.
    generateTextMock.mockImplementation(() =>
      toolCallResponse([
        { toolName: "get_pricing", input: { room: "room1" }, toolCallId: "call_loop" },
      ]),
    );

    const result = await runAgentTurn(
      {
        conversationId: "convo-cap",
        phone: "+351900000099",
        incomingMessage: "Is there a juicer in the kitchen?",
      },
      {
        triggerMessageId: "trigger-1",
        correlationId: "corr-cap",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(8);
    expect(result.stepCount).toBe(8);
    expect(sendOwnerNudgeMock).not.toHaveBeenCalled();

    const last = result.messages.at(-1);
    expect(last?.role).toBe("tool");
  });

  it("keeps looping after a missing_info tool call (a real step.waitForEvent answer flows back as the tool's own result, and the model composes a real final reply in the same turn)", async () => {
    // Overrides this suite's default (resolves null, a timeout) with a real
    // answer, so runMissingInfo returns { escalated: true, answer } directly.
    step.waitForEvent.mockResolvedValueOnce({
      data: { answer: "The sauna is on the ground floor." },
    });
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

    const result = await runAgentTurn(
      {
        conversationId: "convo-sticky",
        phone: "+351900000002",
        incomingMessage: "Is there a sauna?",
      },
      { correlationId: "corr-sticky", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    // The loop kept going after the tool call — the model got a second
    // round and composed real text, not an early return.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBe(2);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Actually, here's the answer about the sauna!",
    });
    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCategory: "missing_info" }),
    );

    const toolMessage = result.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as
      Array<{ toolCallId: string; output: unknown }> | undefined;
    const part = parts?.find((p) => p.toolCallId === "call_esc");
    expect(part?.output).toEqual({
      type: "json",
      value: { escalated: true, answer: "The sauna is on the ground floor." },
    });

    // missing_info manages its own step checkpointing internally (it calls
    // context.step directly), so the outer loop must NOT also wrap it in a
    // step.run (Inngest doesn't support nesting step calls inside another
    // step.run()'s callback) — but requestMissingInfoApproval's own internal
    // steppedSpan DOES create a "hitl-missing_info" step, since it's what
    // creates the hitl.missing_info GATE span the nudge/answer-received spans
    // nest under. Once approved, runMissingInfo's own steppedSpan creates a
    // SEPARATE "tool-missing_info" step too — its own fresh
    // gen_ai.tool.missing_info execution span, with real output known at
    // creation, so no retroactive patch step runs for it.
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("hitl-missing_info");
    expect(stepIds).toContain("tool-missing_info");
    expect(stepIds).not.toContain("update-missing-info-trace-io");

    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info");
    expect(hitlSpan).toBeDefined();
    expect(hitlSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Guest asked about the sauna" }),
    );
    expect(hitlSpan?.attributes["braintrust.input"]).toBe(hitlSpan?.attributes["gca.tool.input"]);
    // The gate span never gets patched on this approved path — only the
    // not-approved exit paths patch it (see the timeout/nudge-failed tests
    // below). Its own real output lands on runMissingInfo's separate
    // execution span instead (asserted next).
    expect(updateSpanIOMock).not.toHaveBeenCalled();

    // The real execution span is a SEPARATE span from the gate span above —
    // created fresh only once approved (by runMissingInfo, via
    // run-tool.ts's runTool), a sibling of the gate span under the turn, not
    // its child. Real output is known at creation time now (same one-shot
    // shape every plain tool already has), so it's a real span attribute.
    const missingInfoExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.missing_info");
    expect(missingInfoExecSpan).toBeDefined();
    expect(missingInfoExecSpan?.attributes["gen_ai.tool.name"]).toBe("missing_info");
    expect(missingInfoExecSpan?.attributes["gca.tool.output"]).toBe(
      JSON.stringify({ escalated: true, answer: "The sauna is on the ground floor." }),
    );

    // hitl.missing_info.nudge nests under the gate span (hitlAnchor), not
    // the turn's own anchor — the outer loop's firedTags/message-shape
    // behavior is otherwise unchanged by this.
    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info.nudge");
    expect(nudgeSpan).toBeDefined();

    // missing_info's own nudge span DOES still carry braintrust.tags
    // directly (unchanged by this fix), so firedTags is a harmless natural
    // side effect here now, not the only route — see
    // RunAgentTurnResult.firedTags.
    expect(result.firedTags).toEqual(["missing_info"]);

    // pending_owner_decisions bookkeeping: recorded once the nudge is
    // confirmed sent (before the wait), then resolved "answered" once the
    // owner's real answer comes back.
    expect(insertPendingOwnerDecisionMock).toHaveBeenCalledWith({
      correlationId: "corr-sticky",
      toolName: "missing_info",
      conversationId: "convo-sticky",
      phone: "+351900000002",
      reason: "Guest asked about the sauna",
    });
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-sticky",
      "answered",
    );
  });

  // The rest of missing_info's suspend/resume behavior — previously unit
  // tested directly against missing-info.ts's exported requestMissingInfoApproval/
  // runMissingInfo — now can only be exercised indirectly through
  // runAgentTurn, same as send_booking_link's approval-gate flow above.
  it("sends the missing_info owner nudge with the reason, conversationId, phone, and correlationId, and falls back to the owner-notified message (running the no-reply-timeout step) when step.waitForEvent times out", async () => {
    // This suite's default: step.waitForEvent resolves null (a timeout).
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
      .mockResolvedValueOnce(textResponse("Let me check with the owner and get back to you."));

    const result = await runAgentTurn(
      { conversationId: "convo-sauna-timeout", phone: "+351900000020", incomingMessage: "Sauna?" },
      { correlationId: "corr-sauna-timeout", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "convo-sauna-timeout",
        phone: "+351900000020",
        reason: "Guest asked about the sauna",
        reasonCategory: "missing_info",
        correlationId: "corr-sauna-timeout",
      }),
    );

    const toolMessage = result.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as
      Array<{ toolCallId: string; output: unknown }> | undefined;
    expect(parts?.find((p) => p.toolCallId === "call_esc")?.output).toEqual({
      type: "json",
      value: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
    });

    // All of missing_info's own steps ran: the gate-span-creation step
    // (FIRST, before the nudge — see requestMissingInfoApproval's own
    // comment), the record-trace-anchor write, the nudge send, the
    // no-reply-timeout fallback (which calls missing-info.ts's
    // handleMissingInfoNoReply — a pure, unmocked, log-only function here),
    // and the retroactive output-patch step (targeting the gate span, since
    // this is a not-approved exit — runMissingInfo/its own
    // "tool-missing_info" step never run on this path at all).
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("hitl-missing_info");
    expect(stepIds).not.toContain("tool-missing_info");
    expect(stepIds).toContain("record-missing-info-trace-anchor");
    expect(stepIds).toContain("hitl-missing-info-nudge");
    expect(stepIds).toContain("hitl-missing-info-no-reply");
    expect(stepIds).toContain("update-missing-info-trace-io");

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info.nudge");
    expect(nudgeSpan).toBeDefined();
    const timeoutSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info.no_reply");
    expect(timeoutSpan).toBeDefined();

    // The gate span only ever carries `input` as a span attribute (set at
    // creation, before the nudge/wait) — the not-approved fallback `output`
    // isn't known until after the wait times out, so it's never a span
    // attribute at creation; it's patched in retroactively via updateSpanIO
    // instead (asserted below). No gen_ai.tool.missing_info execution span
    // exists at all on this not-approved path — the tool never actually ran.
    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info");
    expect(hitlSpan).toBeDefined();
    expect(hitlSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Guest asked about the sauna" }),
    );
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.tool.missing_info"),
    ).toBeUndefined();

    expect(updateSpanIOMock).toHaveBeenCalledWith(hitlSpan?.spanContext().spanId, {
      output: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
    });

    expect(insertPendingOwnerDecisionMock).toHaveBeenCalledWith({
      correlationId: "corr-sauna-timeout",
      toolName: "missing_info",
      conversationId: "convo-sauna-timeout",
      phone: "+351900000020",
      reason: "Guest asked about the sauna",
    });
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-sauna-timeout",
      "timeout",
    );
  });

  it("skips the missing_info wait entirely (and still returns the fallback message) when the nudge itself failed to send", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      .mockResolvedValueOnce(textResponse("Let me check with the owner and get back to you."));

    const result = await runAgentTurn(
      { conversationId: "convo-nudge-fail", phone: "+351900000021", incomingMessage: "Sauna?" },
      { correlationId: "corr-nudge-fail", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const toolMessage = result.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as
      Array<{ toolCallId: string; output: unknown }> | undefined;
    expect(parts?.find((p) => p.toolCallId === "call_esc")?.output).toEqual({
      type: "json",
      value: {
        escalated: true,
        message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
      },
    });
    // Nudge failed means nothing to wait on.
    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("hitl-missing-info-no-reply");

    // The gate span itself is still created on this third exit path too
    // (it's created FIRST, before the nudge is even attempted — see
    // requestMissingInfoApproval's own comment) and its output still gets
    // retroactively patched to the honest nudge-failed fallback message
    // (distinct from the "notified" message the other two exit paths share,
    // since here the owner genuinely was never told). No
    // gen_ai.tool.missing_info execution span exists at all — the tool never
    // ran.
    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info");
    expect(hitlSpan).toBeDefined();
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.tool.missing_info"),
    ).toBeUndefined();
    expect(updateSpanIOMock).toHaveBeenCalledWith(hitlSpan?.spanContext().spanId, {
      output: {
        escalated: true,
        message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
      },
    });

    // No pending_owner_decisions row is ever worth recording for a nudge the
    // owner was never actually told about.
    expect(insertPendingOwnerDecisionMock).not.toHaveBeenCalled();
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).not.toHaveBeenCalled();
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

    const result = await runAgentTurn(
      {
        conversationId: "convo-wants-human",
        phone: "+351900000003",
        incomingMessage: "I want to talk to a person",
      },
      { correlationId: "corr-wants-human", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "convo-wants-human",
        phone: "+351900000003",
        reason: "Guest wants a human",
        reasonCategory: "wants_human",
      }),
    );
    // wants_human's owner-nudge send nests under its own tool-call span
    // (unlike missing_info's/send_booking_link's hitl.<name>.nudge, which
    // nests under a separate gate span — wants_human has no gate at all,
    // see wants-human.ts's own comment) — step id/span name unchanged.
    expect(step.run.mock.calls.map((call) => call[0])).toContain("owner-nudge-wants-human");
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "owner_nudge.wants_human"),
    ).toBeDefined();
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Sure, the owner will reach out shortly.",
    });
    expect(result.firedTags).toEqual(["wants_human"]);

    // wants_human's gen_ai.tool.wants_human execution span is created FIRST,
    // before the nudge (runWantsHuman's own steppedSpan) — same
    // gca.tool.input/braintrust.input shape as missing_info's/send_booking_link's/
    // get_pricing's, but output is NOT a span attribute (unlike the
    // non-suspending tools that use dispatchToolExecution): it isn't known
    // until after the nudge send, well after this span has already closed,
    // so it's patched in retroactively via updateSpanIO instead (asserted
    // below) — same reasoning as missing_info's own gate span.
    expect(step.run.mock.calls.map((call) => call[0])).toContain("tool-wants_human");
    const wantsHumanExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.wants_human");
    expect(wantsHumanExecSpan).toBeDefined();
    expect(wantsHumanExecSpan?.attributes["gen_ai.tool.name"]).toBe("wants_human");
    expect(wantsHumanExecSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Guest wants a human" }),
    );
    expect(wantsHumanExecSpan?.attributes["braintrust.input"]).toBe(
      wantsHumanExecSpan?.attributes["gca.tool.input"],
    );
    expect(wantsHumanExecSpan?.attributes["gca.tool.output"]).toBeUndefined();
    expect(wantsHumanExecSpan?.attributes["braintrust.output"]).toBeUndefined();

    // The retroactive-patch step ran, and patched the real (constant)
    // runWantsHuman() result onto the tool-call span's output.
    expect(step.run.mock.calls.map((call) => call[0])).toContain("update-wants-human-trace-io");
    expect(updateSpanIOMock).toHaveBeenCalledWith(wantsHumanExecSpan?.spanContext().spanId, {
      output: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
    });
  });

  it("dispatches wants_human directly with no approval gate, while send_booking_link goes through its own real NEEDS_APPROVAL-driven wait", async () => {
    // send_booking_link's approval-gate wait — resolve it approved so the call
    // completes with a real { url } result in the same turn.
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "send_booking_link",
            input: {
              guestName: "Ana",
              email: "ana@example.com",
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

    const result = await runAgentTurn(
      {
        conversationId: "convo-hitl",
        phone: "+351900000010",
        incomingMessage: "Book it and also let me talk to someone",
      },
      { correlationId: "corr-hitl", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    // Both tools ran to completion — wants_human isn't in NEEDS_APPROVAL so
    // it dispatches straight through with zero gating, send_booking_link
    // went through its own real requestApprovalGate wait (resolved approved
    // above).
    const toolMessage = result.messages.find((m) => m.role === "tool");
    const bookParts = toolMessage?.content as Array<{ toolCallId: string; toolName: string }>;
    expect(bookParts.find((p) => p.toolCallId === "call_book")?.toolName).toBe("send_booking_link");
    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCategory: "wants_human" }),
    );
    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCategory: "send_booking_link" }),
    );
    // wants_human isn't in NEEDS_APPROVAL, so there's no gate/nudge/wait step
    // under its name at all — only send_booking_link's, driven by
    // requestApprovalGate.
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("hitl-wants_human-nudge");
    expect(step.run.mock.calls.map((call) => call[0])).toContain("hitl-send_booking_link-nudge");
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Sure thing!" });
    // Both tools push into firedTags — order isn't asserted since the two
    // dispatches run concurrently via Promise.all.
    expect(result.firedTags).toEqual(expect.arrayContaining(["wants_human", "send_booking_link"]));
    expect(result.firedTags).toHaveLength(2);
  });

  it("returns the not-approved result and never calls runSendBookingLink when the owner rejects a send_booking_link approval", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: false } });
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "send_booking_link",
            input: {
              guestName: "Ana",
              email: "ana@example.com",
              room: "room1",
              checkIn: "2026-09-01",
              checkOut: "2026-09-05",
            },
            toolCallId: "call_book",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("No problem, let me know if anything changes."));

    const result = await runAgentTurn(
      {
        conversationId: "convo-hitl-reject",
        phone: "+351900000012",
        incomingMessage: "Book it",
      },
      { correlationId: "corr-hitl-reject", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const toolMessage = result.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as Array<{ toolCallId: string; output: unknown }>;
    // Rejected before ever reaching runSendBookingLink — the tool result is
    // exactly the not-approved shape, never a { url }.
    expect(parts.find((p) => p.toolCallId === "call_book")?.output).toEqual({
      type: "json",
      value: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });
    // A rejected gate still pushes into firedTags — a gated call that got a
    // real nudge sent and a real decision made is still worth finding in
    // this turn's trace tags.
    expect(result.firedTags).toEqual(["send_booking_link"]);

    // A rejected call gets its "hitl.send_booking_link" GATE span — it's
    // created FIRST, before requestApprovalGate ever runs (see
    // requestSendBookingLinkApproval's own comment) — but crucially, NO
    // "gen_ai.tool.send_booking_link" execution span exists on this path at
    // all: runSendBookingLink is never called (no "tool-send_booking_link"
    // step either), since the tool never actually ran. This is exactly the
    // shape scripts/braintrust-scorers/hitl-compliance.scorer.ts's
    // checkHitlCompliance already expects for a correctly-withheld call ("no
    // execution span -> compliant") — before this span split, the execution
    // span was created unconditionally before the decision was known, which
    // made every legitimate rejection look like a violation to that scorer.
    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link");
    expect(hitlSpan).toBeDefined();
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.tool.send_booking_link"),
    ).toBeUndefined();
    expect(updateSpanIOMock).toHaveBeenCalledWith(hitlSpan?.spanContext().spanId, {
      output: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("hitl-send_booking_link");
    expect(stepIds).not.toContain("tool-send_booking_link");
    expect(stepIds).toContain("update-send_booking_link-trace-io");

    const decisionSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link.decision");
    expect(decisionSpan?.attributes["gca.approval.decision"]).toBe("rejected");
    expect(requestApprovalGateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "send_booking_link",
        traceAnchor: {
          traceId: TEST_TRACE_ANCHOR.traceId,
          spanId: hitlSpan?.spanContext().spanId,
        },
      }),
    );
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-hitl-reject",
      "rejected",
    );
  });

  it("resolves the pending_owner_decisions row as 'timeout' when a send_booking_link approval times out", async () => {
    // This suite's default: step.waitForEvent resolves null (a timeout).
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "send_booking_link",
            input: {
              guestName: "Ana",
              email: "ana@example.com",
              room: "room1",
              checkIn: "2026-09-01",
              checkOut: "2026-09-05",
            },
            toolCallId: "call_book",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("No problem, let me know if anything changes."));

    await runAgentTurn(
      {
        conversationId: "convo-hitl-timeout",
        phone: "+351900000044",
        incomingMessage: "Book it",
      },
      { correlationId: "corr-hitl-timeout", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(insertPendingOwnerDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "corr-hitl-timeout",
        toolName: "send_booking_link",
      }),
    );
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-hitl-timeout",
      "timeout",
    );
  });

  // The real trace that motivated this fix (see
  // docs/braintrust-online-eval-testing.md section 6n) had two parallel
  // send_booking_link calls in one round — one per room.
  // requestSendBookingLinkApproval has no shared/module-level state
  // (hitlSpanId/hitlAnchor/result are all local to each call's own async
  // frame), so two concurrent invocations should never cross-contaminate
  // each other's spans/decisions purely by construction — this test proves
  // that's actually true at runtime, not just by code review, with one call
  // approved and the other rejected so a mix-up (room1 getting room2's
  // decision, or vice versa) would be visible.
  //
  // step.waitForEvent's two queued resolutions are consumed in call order,
  // not matched by argument (both calls share the same toolName/event/
  // timeout/correlationId — only `reason`'s text differs, and that never
  // reaches waitForEvent) — relies on Promise.all(calls.map(...)) starting
  // each call's async body synchronously in array order, so call[0] (room1)
  // always reaches its first `await` (and every microtask-depth-matched
  // await after it, including this one) before call[1] (room2) does, since
  // both dispatches run the exact same code path. Every other assertion
  // below locates each room's own span by its real gca.tool.input/reason
  // content instead of by array position, so this ordering assumption is
  // scoped to just this one mock queue, not load-bearing for the rest of the
  // test.
  it("dispatches two send_booking_link calls in the same round independently, with no cross-contamination between their spans or decisions", async () => {
    step.waitForEvent
      .mockResolvedValueOnce({ data: { approved: true } })
      .mockResolvedValueOnce({ data: { approved: false } });
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            toolName: "send_booking_link",
            input: {
              guestName: "Ana",
              email: "ana@example.com",
              room: "room1",
              checkIn: "2026-09-01",
              checkOut: "2026-09-05",
            },
            toolCallId: "call_room1",
          },
          {
            toolName: "send_booking_link",
            input: {
              guestName: "Ben",
              email: "ben@example.com",
              room: "room2",
              checkIn: "2026-09-10",
              checkOut: "2026-09-12",
            },
            toolCallId: "call_room2",
          },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Room 1 is booked. Room 2 needs the owner's OK first."));

    const result = await runAgentTurn(
      {
        conversationId: "convo-two-bookings",
        phone: "+351900000060",
        incomingMessage: "Book room 1 for Ana and room 2 for Ben",
      },
      { correlationId: "corr-two-bookings", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const toolMessage = result.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as Array<{ toolCallId: string; output: unknown }>;
    expect(parts.find((p) => p.toolCallId === "call_room1")?.output).toEqual({
      type: "json",
      value: { url: expect.stringContaining("/booking/room1?") },
    });
    expect(parts.find((p) => p.toolCallId === "call_room2")?.output).toEqual({
      type: "json",
      value: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });

    // Two independent gate spans, one per room, each with its own real span
    // id and its own real input — proves hitlAnchor isn't shared.
    const hitlSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === "hitl.send_booking_link");
    expect(hitlSpans).toHaveLength(2);
    const room1HitlSpan = hitlSpans.find((s) =>
      (s.attributes["gca.tool.input"] as string).includes("room1"),
    );
    const room2HitlSpan = hitlSpans.find((s) =>
      (s.attributes["gca.tool.input"] as string).includes("room2"),
    );
    expect(room1HitlSpan).toBeDefined();
    expect(room2HitlSpan).toBeDefined();
    expect(room1HitlSpan?.spanContext().spanId).not.toBe(room2HitlSpan?.spanContext().spanId);

    // Room 1 (approved) gets its own, separate, freshly-created
    // gen_ai.tool.send_booking_link execution span, real output known at
    // creation — never a retroactive patch. Room 2 (rejected) gets none at
    // all: only its own gate span gets patched with the not-approved
    // fallback. Each room's own real output lands on its OWN span, never the
    // other room's — the cross-contamination this test exists to rule out.
    const bookingExecSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(bookingExecSpans).toHaveLength(1);
    expect(bookingExecSpans[0].attributes["gca.tool.output"]).toEqual(
      expect.stringContaining("/booking/room1?"),
    );
    expect(updateSpanIOMock).not.toHaveBeenCalledWith(
      bookingExecSpans[0].spanContext().spanId,
      expect.anything(),
    );
    expect(updateSpanIOMock).not.toHaveBeenCalledWith(
      room1HitlSpan?.spanContext().spanId,
      expect.anything(),
    );
    expect(updateSpanIOMock).toHaveBeenCalledWith(room2HitlSpan?.spanContext().spanId, {
      output: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });

    // Each room's requestApprovalGate call carried its OWN hitlAnchor
    // (located by its own real `reason` text, built from that call's own
    // input — never the other room's).
    const room1GateCall = requestApprovalGateSpy.mock.calls.find((c) =>
      (c[0].reason as string).includes("room1"),
    );
    const room2GateCall = requestApprovalGateSpy.mock.calls.find((c) =>
      (c[0].reason as string).includes("room2"),
    );
    expect(room1GateCall?.[0].traceAnchor).toEqual({
      traceId: TEST_TRACE_ANCHOR.traceId,
      spanId: room1HitlSpan?.spanContext().spanId,
    });
    expect(room2GateCall?.[0].traceAnchor).toEqual({
      traceId: TEST_TRACE_ANCHOR.traceId,
      spanId: room2HitlSpan?.spanContext().spanId,
    });

    // Two independent decision spans — one approved, one rejected, neither
    // mixed up with the other.
    const decisionSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === "hitl.send_booking_link.decision");
    expect(decisionSpans).toHaveLength(2);
    expect(decisionSpans.map((s) => s.attributes["gca.approval.decision"]).sort()).toEqual([
      "approved",
      "rejected",
    ]);

    // Both calls fired independently — order-invariant since both entries
    // are the same literal string.
    expect(result.firedTags).toEqual(["send_booking_link", "send_booking_link"]);
  });

  it("does not gate get_pricing at all (not in NEEDS_APPROVAL, so no nudge and no wait)", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "get_pricing", input: { room: "room1" }, toolCallId: "call_price" },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Got it, here is the price."));

    await runAgentTurn(
      {
        conversationId: "convo-no-gate",
        phone: "+351900000011",
        incomingMessage: "How much is room 1?",
      },
      { correlationId: "corr-no-gate", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(sendOwnerNudgeMock).not.toHaveBeenCalled();
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });

  // dispatchToolExecution (tool-execution.ts) is the shared choke point
  // every non-gated tool call — run_code included — dispatches through.
  // Before this test's fix, a soft-failed tool result (returned, not thrown
  // — see sandbox.ts's runInSandbox, whose every early-return failure branch
  // uses this exact `{ ok: false, error, logs }` shape) closed its execution
  // span as an unmarked success, so a completely broken sandbox looked
  // healthy in any status.code == "ERROR" trace query.
  it("marks the tool-call span failed when run_code's sandbox soft-fails (ok: false)", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "run_code", input: { code: "return 1;" }, toolCallId: "call_run_code" },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Sorted, here you go."));

    const result = await runAgentTurn(
      {
        conversationId: "convo-run-code-fail",
        phone: "+351900000006",
        incomingMessage: "Book the next available weekend",
      },
      { correlationId: "corr-run-code-fail", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    // The tool result the model actually sees is untouched by this fix — a
    // soft-fail still returns its normal { ok: false, error, logs } value,
    // never a throw, never a different shape.
    const toolMessage = result.messages.find((m) => m.role === "tool") as ModelMessage & {
      content: Array<{ toolCallId: string; output: { value: unknown } }>;
    };
    const output = toolMessage?.content.find((p) => p.toolCallId === "call_run_code")?.output.value;
    expect(output).toMatchObject({
      ok: false,
      error: expect.stringContaining("sandbox unavailable"),
    });

    const runCodeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.run_code");
    expect(runCodeSpan?.status.code).toBe(SpanStatusCode.ERROR);
  });

  // get_pricing's own result ({ room, pricePerNight, currency, note } — see
  // pricing.ts) has no `ok`/`error` field at all, the ordinary case
  // detectToolSoftFailure (tool-execution.ts) must leave alone. Regression
  // coverage against a too-broad detector marking every generic tool's
  // successful span failed.
  it("does not mark a successful get_pricing call's span failed", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "get_pricing", input: { room: "room1" }, toolCallId: "call_price_ok" },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Got it, here is the price."));

    await runAgentTurn(
      {
        conversationId: "convo-pricing-ok",
        phone: "+351900000007",
        incomingMessage: "How much is room 1?",
      },
      { correlationId: "corr-pricing-ok", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const pricingSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.get_pricing");
    expect(pricingSpan?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  // Some models (deepseek included) have been observed hallucinating a
  // close-but-wrong tool name in production despite native function-calling
  // supposedly constraining them to the real `tools` ToolSet. runTool's
  // default case turns that into a recoverable tool-result instead of
  // crashing the whole turn, so the model can retry with a real name.
  it("recovers from an unrecognized tool call name instead of crashing the turn, and marks its span failed", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([{ toolName: "bogusTool", input: {}, toolCallId: "call_bogus" }]),
      )
      .mockResolvedValueOnce(textResponse("Sorted, here you go."));

    const result = await runAgentTurn(
      { conversationId: "convo-bogus", phone: "+351900000005", incomingMessage: "Whatever" },
      { correlationId: "corr-bogus", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const toolMessage = result.messages.find((m) => m.role === "tool") as ModelMessage & {
      content: Array<{ toolCallId: string; output: { value: unknown } }>;
    };
    const output = toolMessage?.content.find((p) => p.toolCallId === "call_bogus")?.output.value;
    expect(output).toMatchObject({ error: expect.stringMatching(/unknown tool name.*bogusTool/i) });

    // The "unknown tool name" fallback isn't a separate dispatch path — it
    // still reaches dispatchToolExecution the same way any other non-gated
    // tool call would (bogusTool matches nothing in NEEDS_APPROVAL), so its
    // execution span must get the same ERROR-status treatment as a real
    // soft-fail like run_code's below, not silently close as a normal
    // success.
    const bogusSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.bogusTool");
    expect(bogusSpan?.status.code).toBe(SpanStatusCode.ERROR);
  });

  // Regression coverage for the bug documented in tracing.ts's Braintrust
  // attribute-namespace comment block (4th bullet), same class of bug section
  // 6d of docs/braintrust-online-eval-testing.md fixed for approval-gate.ts's
  // decision/no_reply spans: runWantsHuman's/requestMissingInfoApproval's
  // owner_nudge.wants_human, hitl.missing_info.nudge, and
  // hitl.missing_info.no_reply spans only ever carried gca.*-prefixed
  // attributes, none matching @braintrust/otel's FILTER_PREFIXES, so they
  // were silently dropped before export — confirmed absent from real
  // Braintrust data (see that doc's section 6a Bug 2). The tests above assert
  // what this app's own
  // InMemorySpanExporter sees; they'd pass identically whether or not the
  // real @braintrust/otel filter would also let the span through. This block
  // exercises the real, installed `@braintrust/otel` package's own
  // BraintrustSpanProcessor (same `_spanProcessor` test-injection option and
  // `filterAISpans: true` flag approval-gate.test.ts's equivalent block uses,
  // matching src/instrumentation.ts's real setup) against real ReadableSpan
  // objects runAgentTurn actually emits.
  describe("wants_human/missing_info owner-nudge spans pass the real @braintrust/otel export filter", () => {
    let captured: ReadableSpan[];
    let braintrustProcessor: BraintrustSpanProcessor;

    beforeEach(() => {
      captured = [];
      const capturingProcessor: SpanProcessor = {
        onStart: () => {},
        onEnd: (span) => {
          captured.push(span);
        },
        shutdown: async () => {},
        forceFlush: async () => {},
      };
      // filterAISpans: true wires up the real AISpanProcessor(isAISpan) chain
      // in front of capturingProcessor — onEnd() below is the real, installed
      // export-filtering decision, not a guess at what it does.
      braintrustProcessor = new BraintrustSpanProcessor({
        _spanProcessor: capturingProcessor,
        filterAISpans: true,
      });
    });

    function findSpan(name: string): ReadableSpan {
      const span = spanExporter.getFinishedSpans().find((s) => s.name === name);
      if (!span) {
        throw new Error(`no finished span named "${name}" — check the fixture above`);
      }
      return span;
    }

    it("lets the wants_human nudge span through", async () => {
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

      await runAgentTurn(
        {
          conversationId: "convo-wants-human-filter",
          phone: "+351900000030",
          incomingMessage: "I want to talk to a person",
        },
        { correlationId: "corr-wants-human-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("owner_nudge.wants_human"));

      expect(captured).toHaveLength(1);
    });

    // Confirmed rather than assumed, same as the missing_info execution span
    // check below: this span's name already starts with "gen_ai." (one of
    // @braintrust/otel's own FILTER_PREFIXES — see
    // node_modules/@braintrust/otel/dist/index.js's isAISpan), so it should
    // clear the real filter on that alone.
    it("lets the wants_human execution span through, on its own gen_ai. name prefix", async () => {
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

      await runAgentTurn(
        {
          conversationId: "convo-wants-human-exec-filter",
          phone: "+351900000034",
          incomingMessage: "I want to talk to a person",
        },
        { correlationId: "corr-wants-human-exec-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("gen_ai.tool.wants_human"));

      expect(captured).toHaveLength(1);
    });

    it("lets the missing_info nudge span through", async () => {
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
        .mockResolvedValueOnce(textResponse("Let me check with the owner and get back to you."));

      await runAgentTurn(
        {
          conversationId: "convo-missing-info-filter",
          phone: "+351900000031",
          incomingMessage: "Sauna?",
        },
        { correlationId: "corr-missing-info-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("hitl.missing_info.nudge"));

      expect(captured).toHaveLength(1);
    });

    it("lets the missing_info no_reply/timeout span through", async () => {
      // beforeEach already defaults step.waitForEvent to resolving null (a
      // timeout), driving requestMissingInfoApproval's no-reply fallback.
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
        .mockResolvedValueOnce(textResponse("Let me check with the owner and get back to you."));

      await runAgentTurn(
        {
          conversationId: "convo-missing-info-timeout-filter",
          phone: "+351900000032",
          incomingMessage: "Sauna?",
        },
        { correlationId: "corr-missing-info-timeout-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("hitl.missing_info.no_reply"));

      expect(captured).toHaveLength(1);
    });

    // Confirmed rather than assumed, consistent with this suite's own
    // standing verification bar: this span's name already starts with
    // "gen_ai." (one of @braintrust/otel's own FILTER_PREFIXES — see
    // node_modules/@braintrust/otel/dist/index.js's isAISpan), so it should
    // clear the real filter on that alone, with no braintrust.*-prefixed
    // attribute needed the way the sibling nudge/no_reply spans above do.
    // Only created on the approved path now (an answer must actually arrive
    // for runMissingInfo to run at all), so this overrides the describe
    // block's default timeout — unlike the two tests above, which exercise
    // the not-approved gate span/spans instead.
    it("lets the missing_info execution span through, on its own gen_ai. name prefix", async () => {
      step.waitForEvent.mockResolvedValueOnce({
        data: { correlationId: "corr-missing-info-exec-filter", answer: "The AC is above the bed" },
      });
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
        .mockResolvedValueOnce(textResponse("Let me check with the owner and get back to you."));

      await runAgentTurn(
        {
          conversationId: "convo-missing-info-exec-filter",
          phone: "+351900000033",
          incomingMessage: "Sauna?",
        },
        { correlationId: "corr-missing-info-exec-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("gen_ai.tool.missing_info"));

      expect(captured).toHaveLength(1);
    });

    // send_booking_link's hitl.send_booking_link.nudge/.decision/.no_reply
    // spans nest under requestSendBookingLinkApproval's own hitlAnchor
    // instead of the turn's own anchor (see that function's comment) —
    // reparenting only changes a span's parent context, not its own
    // name/attributes, which is all @braintrust/otel's isAISpan check
    // inspects, so these three should still clear the filter the same way
    // they did before this change (via their existing
    // braintrust.tags/braintrust.approval_decision attribute-prefix trick,
    // established in section 6d) — confirmed here against the real,
    // reparented spans runAgentTurn actually emits now, not assumed to still
    // hold just because approval-gate.test.ts's own (unreparented,
    // fixed-anchor) equivalent block still passes.
    it("lets the send_booking_link nudge span through, reparented under its own gate span", async () => {
      step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
              input: {
                guestName: "Ana",
                email: "ana@example.com",
                room: "room1",
                checkIn: "2026-09-01",
                checkOut: "2026-09-05",
              },
              toolCallId: "call_book",
            },
          ]),
        )
        .mockResolvedValueOnce(textResponse("All set, here is your link!"));

      await runAgentTurn(
        {
          conversationId: "convo-booking-filter",
          phone: "+351900000040",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("hitl.send_booking_link.nudge"));

      expect(captured).toHaveLength(1);
    });

    it("lets the send_booking_link execution span through, on its own gen_ai. name prefix", async () => {
      step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
              input: {
                guestName: "Ana",
                email: "ana@example.com",
                room: "room1",
                checkIn: "2026-09-01",
                checkOut: "2026-09-05",
              },
              toolCallId: "call_book",
            },
          ]),
        )
        .mockResolvedValueOnce(textResponse("All set, here is your link!"));

      await runAgentTurn(
        {
          conversationId: "convo-booking-exec-filter",
          phone: "+351900000041",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-exec-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("gen_ai.tool.send_booking_link"));

      expect(captured).toHaveLength(1);
    });

    it("lets the send_booking_link decision span through, reparented under its own gate span", async () => {
      step.waitForEvent.mockResolvedValueOnce({ data: { approved: false } });
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
              input: {
                guestName: "Ana",
                email: "ana@example.com",
                room: "room1",
                checkIn: "2026-09-01",
                checkOut: "2026-09-05",
              },
              toolCallId: "call_book",
            },
          ]),
        )
        .mockResolvedValueOnce(textResponse("No problem, let me know if anything changes."));

      await runAgentTurn(
        {
          conversationId: "convo-booking-decision-filter",
          phone: "+351900000042",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-decision-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("hitl.send_booking_link.decision"));

      expect(captured).toHaveLength(1);
    });

    it("lets the send_booking_link no_reply/timeout span through, reparented under its own gate span", async () => {
      // beforeEach already defaults step.waitForEvent to resolving null (a
      // timeout).
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
              input: {
                guestName: "Ana",
                email: "ana@example.com",
                room: "room1",
                checkIn: "2026-09-01",
                checkOut: "2026-09-05",
              },
              toolCallId: "call_book",
            },
          ]),
        )
        .mockResolvedValueOnce(textResponse("No problem, let me know if anything changes."));

      await runAgentTurn(
        {
          conversationId: "convo-booking-timeout-filter",
          phone: "+351900000043",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-timeout-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("hitl.send_booking_link.no_reply"));

      expect(captured).toHaveLength(1);
    });
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
