import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
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
// sendBookingLink span-tagging test below inspect the actual attributes a
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

// checkAvailability does a real fetch() and answerPropertyQuestion a real
// embedding call, so neither is exercised here. No more escalations table —
// requestOwnerNudge talks to telegram-router only, not Supabase. sendBookingLink
// is a pure stub now (no DB write), so createAdminClient is never actually
// called from any path this file exercises.
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(() => ({})),
  // property-question.ts calls createClient() at module load time, so this
  // must be present even though no test here calls that tool.
  createClient: vi.fn(() => ({})),
}));

const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const recordMessageMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  recordMessage: recordMessageMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

// tracing.ts's real withTurnSpan stays real (it's pure OTel API calls, no
// network) so run-turn.ts's "start-trace"/model/tool spans still exercise
// real span-id generation — only updateSpanIO (a real fetch() to
// Braintrust's REST API) is mocked, the same "mock the module's exported
// external-call function directly" style used for sendWhatsAppMessage etc.
// above.
const updateSpanIOMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  return { ...actual, updateSpanIO: updateSpanIOMock };
});

// run-turn.ts's loadPrompt({ slug: SYSTEM_PROMPT_SLUG, ... }) call — mocked
// to return a stub Prompt whose build() returns a fixed messages array,
// instead of actually hitting Braintrust.
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

const { runAgentTurn, runGuestTurn, sanitizeReplyText } = await import("@/agent/run-turn.js");

const SYSTEM_PROMPT_TEXT = "You are the whatsapp booking agent.";

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

// Hand-rolled Inngest step mock — mirrors how @dbos-inc/dbos-sdk used to be
// hand-mocked in this suite. step.run immediately invokes its callback
// (matching how a real step.run behaves from the caller's perspective once
// memoized state doesn't short-circuit it) rather than pulling in
// @inngest/test's heavier InngestTestEngine harness, since run-turn.ts now
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

// A round where the model produced neither text nor a tool call — the
// degenerate response modelTurn's retry loop exists for.
function emptyResponse(finishReason: string) {
  return {
    text: "",
    toolCalls: [] as unknown[],
    response: { messages: [] as ModelMessage[] },
    finishReason,
  };
}

describe("runAgentTurn", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    step = makeStepMock();
    // waitForEvent defaults to resolving null (a timeout), driving
    // runMissingInfo's real "owner has been notified" fallback path.
    step.waitForEvent.mockResolvedValue(null);
    loadMemoryMock.mockResolvedValue({
      historyMessages: [],
      contextBlock: "No prior guest information available.",
    });
    loadPromptMock.mockResolvedValue({
      build: () => ({ messages: [{ role: "system", content: SYSTEM_PROMPT_TEXT }] }),
    });
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
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

    await runAgentTurn(
      {
        conversationId: "convo-1",
        phone: "+3519",
        incomingMessage: "Also, is breakfast included?",
      },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(loadMemoryMock).toHaveBeenCalledWith({
      conversationId: "convo-1",
      phone: "+3519",
      traceAnchor: expect.any(Object),
    });

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
      .mockResolvedValueOnce(emptyResponse("stop"))
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
        attributes: { attempt: 1, finishReason: "stop" },
      }),
    );
  });

  it("gives up after 3 empty attempts, falls back to the generic apology reply, and marks the span failed", async () => {
    generateTextMock.mockImplementation(() => emptyResponse("stop"));

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
          { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_price" },
        ]),
      )
      .mockResolvedValueOnce(textResponse("Here's the price."));

    await runAgentTurn(
      { conversationId: "convo-1", phone: "+3519", incomingMessage: "How much is room 1?" },
      { correlationId: "corr-1", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("model-1");
    expect(stepIds).toContain("tool-getPricing");
    expect(stepIds).toContain("model-2");
  });

  it("fans out to every tool call in one round and correlates tool results by tool_call_id, then loops back to the model", async () => {
    // sendBookingLink now genuinely suspends on step.waitForEvent, via
    // run-turn.ts's APPROVAL_GATES table + approval-gate.ts's
    // requestApprovalGate — resolve it approved so this test can still
    // assert on a real { url } tool result and a real final reply.
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
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
    expect(parts.find((p) => p.toolCallId === "call_price")?.toolName).toBe("getPricing");
    expect(parts.find((p) => p.toolCallId === "call_book")?.toolName).toBe("sendBookingLink");
    expect(parts.find((p) => p.toolCallId === "call_book")?.output).toEqual({
      type: "json",
      value: { url: expect.stringContaining("room=room1") },
    });

    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "All set, here is your link!",
    });

    // sendBookingLink no longer passes through the generic
    // "tool-${toolName}" wrapper (it's SELF_STEPPED_TOOLS now — see
    // run-turn.ts's comment), so there's no "gen_ai.tool.sendBookingLink"
    // span anymore. Its own "owner_nudge.sendBookingLink" span (opened
    // inside approval-gate.ts's requestApprovalGate, invoked here via
    // run-turn.ts's APPROVAL_GATES table) carries the "braintrust.tags" tag
    // instead, preserving the same trace filterability the old wrapper's
    // tag gave.
    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.sendBookingLink");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["sendBookingLink"]);

    // getPricing isn't sendBookingLink — its own span must not pick up the tag.
    const pricingSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.getPricing");
    expect(pricingSpan?.attributes["braintrust.tags"]).toBeUndefined();

    // sendBookingLink is SELF_STEPPED_TOOLS now, like wants_human/missing_info
    // — it must not also be nested inside an outer "tool-sendBookingLink"
    // step.run.
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("tool-sendBookingLink");
  });

  it("stops looping once MAX_AGENT_STEPS is hit, without an extra model call or an owner nudge", async () => {
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
      | Array<{ toolCallId: string; output: unknown }>
      | undefined;
    const part = parts?.find((p) => p.toolCallId === "call_esc");
    expect(part?.output).toEqual({
      type: "json",
      value: { escalated: true, answer: "The sauna is on the ground floor." },
    });

    // missing_info manages its own step checkpointing internally (it calls
    // context.step directly) — it must NOT also be wrapped in an outer
    // "tool-missing_info" step.run, since Inngest doesn't support nesting
    // step calls inside another step.run()'s callback.
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("tool-missing_info");

    // wants_human/missing_info never get a span of their own (see
    // SELF_STEPPED_TOOLS's comment in run-turn.ts), so firedTags is the
    // deferred route runGuestTurn uses to still tag this turn's trace — see
    // RunAgentTurnResult.firedTags.
    expect(result.firedTags).toEqual(["missing_info"]);
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
      expect.objectContaining({ reasonCategory: "wants_human" }),
    );
    // Same nesting concern as missing_info above.
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("tool-wants_human");
    expect(result.firedTags).toEqual(["wants_human"]);
  });

  it("dispatches wants_human directly with no approval gate, while sendBookingLink goes through its own real APPROVAL_GATES-driven wait", async () => {
    // sendBookingLink's approval-gate wait — resolve it approved so the call
    // completes with a real { url } result in the same turn.
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
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

    const result = await runAgentTurn(
      {
        conversationId: "convo-hitl",
        phone: "+351900000010",
        incomingMessage: "Book it and also let me talk to someone",
      },
      { correlationId: "corr-hitl", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    // Both tools ran to completion — wants_human has no APPROVAL_GATES entry
    // so it dispatches straight through with zero gating, sendBookingLink
    // went through its own real requestApprovalGate wait (resolved approved
    // above).
    const toolMessage = result.messages.find((m) => m.role === "tool");
    const bookParts = toolMessage?.content as Array<{ toolCallId: string; toolName: string }>;
    expect(bookParts.find((p) => p.toolCallId === "call_book")?.toolName).toBe("sendBookingLink");
    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCategory: "wants_human" }),
    );
    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCategory: "send_booking_link" }),
    );
    // wants_human has no entry in run-turn.ts's APPROVAL_GATES table, so
    // there's no nudge/wait step under its name at all — only
    // sendBookingLink's, driven by requestApprovalGate.
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("owner-nudge-wants_human");
    expect(step.run.mock.calls.map((call) => call[0])).toContain("owner-nudge-sendBookingLink");
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Sure thing!" });
    // Both tools are SELF_STEPPED_TOOLS, so both push into firedTags — order
    // isn't asserted since the two dispatches run concurrently via
    // Promise.all.
    expect(result.firedTags).toEqual(expect.arrayContaining(["wants_human", "sendBookingLink"]));
    expect(result.firedTags).toHaveLength(2);
  });

  it("returns the not-approved result and never calls runSendBookingLink when the owner rejects a sendBookingLink approval", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: false } });
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
    // A rejected gate still pushes into firedTags — same as before
    // APPROVAL_GATES existed (a gated call that got a real nudge sent and a
    // real decision made is still worth finding in this turn's trace tags).
    expect(result.firedTags).toEqual(["sendBookingLink"]);
  });

  it("does not gate getPricing at all (no APPROVAL_GATES entry, so no nudge and no wait)", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        toolCallResponse([
          { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_price" },
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

  // Some models (deepseek included) have been observed hallucinating a
  // close-but-wrong tool name in production despite native function-calling
  // supposedly constraining them to the real `tools` ToolSet. runToolCall()'s
  // default case turns that into a recoverable tool-result instead of
  // crashing the whole turn, so the model can retry with a real name.
  it("recovers from an unrecognized tool call name instead of crashing the turn", async () => {
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

// The Inngest-driven delivery orchestrator: drives the real runAgentTurn
// (via this suite's existing mocks — loadMemory, generateText, etc.), then
// records the reply and sends it proactively. No CRM touch step — see the
// CRM removal in this app's history. runGuestTurn is the plain function
// runGuestTurnFunction (in the real app) wraps with inngest.createFunction —
// exercised directly here with a hand-rolled step mock instead of a real
// Inngest engine.
describe("runGuestTurn", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    step = makeStepMock();
    step.waitForEvent.mockResolvedValue(null);
    loadMemoryMock.mockResolvedValue({
      historyMessages: [],
      contextBlock: "No prior guest information available.",
    });
    loadPromptMock.mockResolvedValue({
      build: () => ({ messages: [{ role: "system", content: SYSTEM_PROMPT_TEXT }] }),
    });
    recordMessageMock.mockResolvedValue("msg-assistant-1");
    sendWhatsAppMessageMock.mockResolvedValue({ ok: true });
    updateSpanIOMock.mockResolvedValue(undefined);
  });

  it("runs the turn, records the assistant reply, and sends it via Twilio, both inside their own step.run", async () => {
    generateTextMock.mockResolvedValueOnce(textResponse("Yes, room 1 is available!"));

    await runGuestTurn({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "Is room 1 free?",
      triggerMessageId: "msg-user-1",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
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
    expect(updateSpanIOMock).toHaveBeenCalledWith(expect.any(String), {
      input: "Is room 1 free?",
      output: "Yes, room 1 is available!",
    });
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toEqual(
      expect.arrayContaining(["update-turn-trace-io", "record-reply", "send-whatsapp-reply"]),
    );
  });

  it("passes firedTags through to updateSpanIO's tags when the turn escalated via wants_human", async () => {
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
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

    await runGuestTurn({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "I want to talk to a person",
      correlationId: "corr-tags",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(updateSpanIOMock).toHaveBeenCalledWith(expect.any(String), {
      input: "I want to talk to a person",
      output: "Sure, the owner will reach out shortly.",
      tags: ["wants_human"],
    });
  });

  it("falls back to a generic apology reply when the turn's last message isn't a string assistant message", async () => {
    // Model always responds with a tool call, so the loop never produces a
    // final text reply — same step-cap shape as the runAgentTurn suite above.
    generateTextMock.mockImplementation(() =>
      toolCallResponse([
        { toolName: "getPricing", input: { room: "room1" }, toolCallId: "call_loop" },
      ]),
    );

    await runGuestTurn({
      conversationId: "convo-1",
      phone: "+351920742845",
      incomingMessage: "???",
      correlationId: "corr-2",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
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
      runGuestTurn({
        conversationId: "convo-1",
        phone: "+351920742845",
        incomingMessage: "Hi",
        correlationId: "corr-3",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Twilio rejected the number"),
    );
    consoleErrorSpy.mockRestore();
  });
});
