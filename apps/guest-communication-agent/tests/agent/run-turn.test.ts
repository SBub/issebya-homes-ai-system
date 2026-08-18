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
const foldMemoryMock = vi.fn();
vi.mock("@/agent/memory.js", () => ({
  loadMemory: loadMemoryMock,
  foldMemory: foldMemoryMock,
}));

// check_availability does a real fetch() and answer_property_question a real
// embedding call, so neither is exercised here. No more escalations table —
// requestOwnerNudge talks to telegram-router only, not Supabase.
// send_booking_link is a pure stub now (no DB write). The one real caller left
// is tracing.ts's recordMissingInfoTraceAnchor (via runMissingInfo, on every
// missing_info dispatch) — insert() always resolves cleanly here so that
// best-effort write's own try/catch never has anything to report; the write
// itself isn't asserted on in this file (see the owner-nudges answer route's
// own test file for the read side of this same table).
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

// approval-gate.ts's requestApprovalGate stays real (it's what actually
// sends the nudge and drives step.waitForEvent) — spied, not replaced, so
// the send_booking_link reparenting tests below can assert on the real
// `traceAnchor` param dispatchGatedToolCall actually passed it, since real
// parent/child span linkage isn't observable in this harness (see the "fans
// out" test's own comment for why).
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
      memoryMessage: null,
    });
    loadPromptMock.mockResolvedValue({
      build: () => ({ messages: [{ role: "system", content: SYSTEM_PROMPT_TEXT }] }),
    });
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
    recordMessageMock.mockResolvedValue("msg-assistant-1");
    sendWhatsAppMessageMock.mockResolvedValue({ ok: true });
  });

  it("builds the model call's system prompt string, then uses historyMessages as-is with no extra append", async () => {
    // historyMessages already ends with this turn's incoming guest message —
    // the webhook route records it to whatsapp_messages before the turn ever
    // starts, so loadMemory's own DB read (real code, mocked wholesale here)
    // always returns it as the last row. run-turn.ts must not append
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
    // run-turn.ts's APPROVAL_GATES table + approval-gate.ts's
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
      value: { url: expect.stringContaining("room=room1") },
    });

    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "All set, here is your link!",
    });

    // send_booking_link no longer passes through the generic
    // dispatchTracedToolCall wrapper (it's SELF_STEPPED_TOOLS, gated through
    // dispatchGatedToolCall first — see run-turn.ts's comment). Its
    // "gen_ai.tool.send_booking_link" execution span is now created FIRST, in
    // run-turn.ts's dispatchGatedToolCall, BEFORE requestApprovalGate ever
    // runs — so "owner_nudge.send_booking_link" (opened inside
    // approval-gate.ts's requestApprovalGate) nests as this span's real
    // child, not its sibling. Literal parent/child span linkage
    // (ReadableSpan.parentSpanContext.spanId) can't actually be asserted in
    // this vitest environment — no real AsyncLocalStorage-based
    // ContextManager is registered here (only instrumentation.ts registers
    // one, for the real Next.js runtime), so context.with() silently no-ops
    // and every span gets its own independently-generated trace id
    // regardless of the anchor passed in (documented harness limitation, see
    // docs/braintrust-online-eval-testing.md section 6k). Asserting the real
    // `traceAnchor` param requestApprovalGate was actually called with
    // (below, via requestApprovalGateSpy) is the strongest same-harness
    // proof of correct reparenting available instead.
    const bookingExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(bookingExecSpan).toBeDefined();
    expect(requestApprovalGateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "send_booking_link",
        traceAnchor: {
          traceId: TEST_TRACE_ANCHOR.traceId,
          spanId: bookingExecSpan?.spanContext().spanId,
        },
      }),
    );

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.send_booking_link");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["send_booking_link"]);

    expect(bookingExecSpan?.attributes["gen_ai.tool.name"]).toBe("send_booking_link");
    expect(bookingExecSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({
        guestName: "Ana",
        room: "room1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-05",
      }),
    );
    expect(bookingExecSpan?.attributes["braintrust.input"]).toBe(
      bookingExecSpan?.attributes["gca.tool.input"],
    );
    // Output isn't known until after requestApprovalGate resolves, well
    // after this span has already closed — same as missing_info's/
    // wants_human's own execution spans, it's never a span attribute, only
    // a retroactive updateSpanIO patch (asserted below).
    expect(bookingExecSpan?.attributes["gca.tool.output"]).toBeUndefined();
    expect(bookingExecSpan?.attributes["braintrust.output"]).toBeUndefined();
    expect(updateSpanIOMock).toHaveBeenCalledWith(bookingExecSpan?.spanContext().spanId, {
      output: { url: expect.stringContaining("room=room1") },
    });

    // get_pricing isn't send_booking_link — its own span must not pick up the tag.
    const pricingSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.get_pricing");
    expect(pricingSpan?.attributes["braintrust.tags"]).toBeUndefined();

    // send_booking_link IS a real "tool-send_booking_link" step now (the
    // tool-span-creation step, created before the gate) — it's dispatched
    // via the SELF_STEPPED_TOOLS branch, not the generic
    // dispatchTracedToolCall path. The approved dispatch itself, and the
    // retroactive output patch, are each their own separate step too.
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("tool-send_booking_link");
    expect(stepIds).toContain("execute-send_booking_link");
    expect(stepIds).toContain("update-send_booking_link-trace-io");

    // The approval decision itself is independently visible too — nested
    // under the same tool-call span in a real trace (see the
    // requestApprovalGateSpy assertion above for why that's asserted via the
    // real traceAnchor param instead of literal span linkage here).
    const decisionSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.send_booking_link.decision");
    expect(decisionSpan?.attributes["gca.approval.decision"]).toBe("approved");
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
      | Array<{ toolCallId: string; output: unknown }>
      | undefined;
    const part = parts?.find((p) => p.toolCallId === "call_esc");
    expect(part?.output).toEqual({
      type: "json",
      value: { escalated: true, answer: "The sauna is on the ground floor." },
    });

    // missing_info manages its own step checkpointing internally (it calls
    // context.step directly), so the outer loop must NOT also wrap it in a
    // "tool-missing_info" step.run (Inngest doesn't support nesting step
    // calls inside another step.run()'s callback) — but runMissingInfo's own
    // internal steppedSpan DOES create a step of that exact id, now called
    // FIRST (before the nudge, not after the wait) since it's what creates
    // the gen_ai.tool.missing_info span the nudge/no_reply spans nest under
    // — see this function's own top comment.
    expect(step.run.mock.calls.map((call) => call[0])).toContain("tool-missing_info");
    // The retroactive output-patch step also ran, once the wait resolved.
    expect(step.run.mock.calls.map((call) => call[0])).toContain("update-missing-info-trace-io");

    const missingInfoExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.missing_info");
    expect(missingInfoExecSpan).toBeDefined();
    expect(missingInfoExecSpan?.attributes["gen_ai.tool.name"]).toBe("missing_info");
    // Only `input` is set as a span attribute at creation time — `output`
    // isn't known until after step.waitForEvent resolves, well after this
    // span has already closed, so it's never a span attribute at all; it's
    // patched in retroactively via updateSpanIO instead (asserted below).
    expect(missingInfoExecSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Guest asked about the sauna" }),
    );
    expect(missingInfoExecSpan?.attributes["braintrust.input"]).toBe(
      missingInfoExecSpan?.attributes["gca.tool.input"],
    );
    expect(missingInfoExecSpan?.attributes["gca.tool.output"]).toBeUndefined();
    expect(missingInfoExecSpan?.attributes["braintrust.output"]).toBeUndefined();

    // The retroactive patch — same mechanism (and the same best-effort
    // reliability caveat) runAgentTurn's own "braintrust.guest_turn" root
    // marker span already uses for its output.
    expect(updateSpanIOMock).toHaveBeenCalledWith(missingInfoExecSpan?.spanContext().spanId, {
      output: { escalated: true, answer: "The sauna is on the ground floor." },
    });

    // owner_nudge.missing_info now nests under the tool-call span
    // (toolAnchor) instead of the turn's own anchor — the outer loop's
    // firedTags/message-shape behavior is otherwise unchanged by this
    // reparenting.
    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.missing_info");
    expect(nudgeSpan).toBeDefined();

    // missing_info's owner-nudge span DOES still carry braintrust.tags
    // directly (unchanged by this fix — see run-turn.ts's dispatchWantsHuman
    // comment), so firedTags is a harmless natural side effect here now, not
    // the only route — see RunAgentTurnResult.firedTags.
    expect(result.firedTags).toEqual(["missing_info"]);
  });

  // The rest of missing_info's suspend/resume behavior — previously unit
  // tested directly against missing-info.ts's exported runMissingInfo/
  // waitForMissingInfoReply — now lives in run-turn.ts's private
  // runMissingInfo (see that file's "tool files stay pure" rule) and can only
  // be exercised indirectly through runAgentTurn, same as send_booking_link's
  // approval-gate flow above.
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
      | Array<{ toolCallId: string; output: unknown }>
      | undefined;
    expect(parts?.find((p) => p.toolCallId === "call_esc")?.output).toEqual({
      type: "json",
      value: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
    });

    // All of missing_info's own steps ran: the tool-span-creation step
    // (now FIRST, before the nudge — see runMissingInfo's own comment), the
    // record-trace-anchor write, the nudge send, the no-reply-timeout
    // fallback (which calls missing-info.ts's handleMissingInfoNoReply — a
    // pure, unmocked, log-only function here), and the retroactive
    // output-patch step.
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("tool-missing_info");
    expect(stepIds).toContain("record-missing-info-trace-anchor");
    expect(stepIds).toContain("owner-nudge-missing-info");
    expect(stepIds).toContain("missing-info-no-reply");
    expect(stepIds).toContain("update-missing-info-trace-io");

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.missing_info");
    expect(nudgeSpan).toBeDefined();
    const timeoutSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "missing_info.no_reply");
    expect(timeoutSpan).toBeDefined();

    // The timeout case's own execution span only ever carries `input` as a
    // span attribute (set at creation, before the nudge/wait) — the
    // fallback `output` isn't known until after the wait times out, so it's
    // never a span attribute; it's patched in retroactively via
    // updateSpanIO instead (asserted below), same as the answered case.
    const missingInfoExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.missing_info");
    expect(missingInfoExecSpan).toBeDefined();
    expect(missingInfoExecSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Guest asked about the sauna" }),
    );
    expect(missingInfoExecSpan?.attributes["gca.tool.output"]).toBeUndefined();

    expect(updateSpanIOMock).toHaveBeenCalledWith(missingInfoExecSpan?.spanContext().spanId, {
      output: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
    });
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
      | Array<{ toolCallId: string; output: unknown }>
      | undefined;
    expect(parts?.find((p) => p.toolCallId === "call_esc")?.output).toEqual({
      type: "json",
      value: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
    });
    // Nudge failed means nothing to wait on.
    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("missing-info-no-reply");

    // The tool-call span itself is still created on this third exit path too
    // (it's created FIRST, before the nudge is even attempted — see
    // runMissingInfo's own comment) and its output still gets retroactively
    // patched to the same fallback message all three exit paths share.
    const missingInfoExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.missing_info");
    expect(missingInfoExecSpan).toBeDefined();
    expect(missingInfoExecSpan?.attributes["gca.tool.output"]).toBeUndefined();
    expect(updateSpanIOMock).toHaveBeenCalledWith(missingInfoExecSpan?.spanContext().spanId, {
      output: {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      },
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
    // wants_human's owner-nudge send now nests under the tool-call span
    // (toolAnchor) instead of the turn's own anchor — same reparenting
    // runMissingInfo's own owner_nudge.missing_info gets (see
    // dispatchWantsHuman's own comment) — step id/span name unchanged.
    expect(step.run.mock.calls.map((call) => call[0])).toContain("owner-nudge-wants-human");
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "owner_nudge.wants_human"),
    ).toBeDefined();
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Sure, the owner will reach out shortly.",
    });
    expect(result.firedTags).toEqual(["wants_human"]);

    // wants_human's gen_ai.tool.wants_human execution span is now created
    // FIRST, before the nudge (dispatchWantsHuman's own steppedSpan) — same
    // gca.tool.input/braintrust.input shape as missing_info's/send_booking_link's/
    // get_pricing's, but output is NOT a span attribute (unlike the
    // non-suspending tools that use dispatchToolExecution): it isn't known
    // until after the nudge send, well after this span has already closed,
    // so it's patched in retroactively via updateSpanIO instead (asserted
    // below) — same reasoning as missing_info's own execution span.
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

  it("dispatches wants_human directly with no approval gate, while send_booking_link goes through its own real APPROVAL_GATES-driven wait", async () => {
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
    // so it dispatches straight through with zero gating, send_booking_link
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
    // wants_human has no entry in run-turn.ts's APPROVAL_GATES table, so
    // there's no nudge/wait step under its name at all — only
    // send_booking_link's, driven by requestApprovalGate.
    expect(step.run.mock.calls.map((call) => call[0])).not.toContain("owner-nudge-wants_human");
    expect(step.run.mock.calls.map((call) => call[0])).toContain("owner-nudge-send_booking_link");
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Sure thing!" });
    // Both tools are SELF_STEPPED_TOOLS, so both push into firedTags — order
    // isn't asserted since the two dispatches run concurrently via
    // Promise.all.
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
    expect(result.firedTags).toEqual(["send_booking_link"]);

    // A rejected call still gets its "gen_ai.tool.send_booking_link" execution
    // span — it's created FIRST, before requestApprovalGate ever runs (see
    // dispatchGatedToolCall's own comment), so the tool-call span exists
    // regardless of outcome, unlike the pre-fix behavior where only an
    // approved call ever got one. runSendBookingLink itself is never called
    // on this path (no "execute-send_booking_link" step) — only the
    // not-approved shape gets retroactively patched onto the span's output.
    const bookingExecSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(bookingExecSpan).toBeDefined();
    expect(bookingExecSpan?.attributes["gca.tool.output"]).toBeUndefined();
    expect(updateSpanIOMock).toHaveBeenCalledWith(bookingExecSpan?.spanContext().spanId, {
      output: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toContain("tool-send_booking_link");
    expect(stepIds).not.toContain("execute-send_booking_link");
    expect(stepIds).toContain("update-send_booking_link-trace-io");

    const decisionSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.send_booking_link.decision");
    expect(decisionSpan?.attributes["gca.approval.decision"]).toBe("rejected");
    expect(requestApprovalGateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "send_booking_link",
        traceAnchor: {
          traceId: TEST_TRACE_ANCHOR.traceId,
          spanId: bookingExecSpan?.spanContext().spanId,
        },
      }),
    );
  });

  // The real trace that motivated this fix (see
  // docs/braintrust-online-eval-testing.md section 6n) had two parallel
  // send_booking_link calls in one round — one per room. dispatchGatedToolCall
  // has no shared/module-level state (toolSpanId/toolAnchor/result are all
  // local to each call's own async frame), so two concurrent invocations
  // should never cross-contaminate each other's spans/decisions purely by
  // construction — this test proves that's actually true at runtime, not
  // just by code review, with one call approved and the other rejected so a
  // mix-up (room1 getting room2's decision, or vice versa) would be visible.
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
      value: { url: expect.stringContaining("room=room1") },
    });
    expect(parts.find((p) => p.toolCallId === "call_room2")?.output).toEqual({
      type: "json",
      value: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });

    // Two independent tool-call spans, one per room, each with its own real
    // span id and its own real input — proves toolAnchor isn't shared.
    const bookingExecSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(bookingExecSpans).toHaveLength(2);
    const room1Span = bookingExecSpans.find((s) =>
      (s.attributes["gca.tool.input"] as string).includes("room1"),
    );
    const room2Span = bookingExecSpans.find((s) =>
      (s.attributes["gca.tool.input"] as string).includes("room2"),
    );
    expect(room1Span).toBeDefined();
    expect(room2Span).toBeDefined();
    expect(room1Span?.spanContext().spanId).not.toBe(room2Span?.spanContext().spanId);

    // Each room's own output is patched onto its OWN span's id, not the
    // other room's — the cross-contamination this test exists to rule out.
    expect(updateSpanIOMock).toHaveBeenCalledWith(room1Span?.spanContext().spanId, {
      output: { url: expect.stringContaining("room=room1") },
    });
    expect(updateSpanIOMock).toHaveBeenCalledWith(room2Span?.spanContext().spanId, {
      output: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
    });

    // Each room's requestApprovalGate call carried its OWN toolAnchor
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
      spanId: room1Span?.spanContext().spanId,
    });
    expect(room2GateCall?.[0].traceAnchor).toEqual({
      traceId: TEST_TRACE_ANCHOR.traceId,
      spanId: room2Span?.spanContext().spanId,
    });

    // Two independent decision spans — one approved, one rejected, neither
    // mixed up with the other.
    const decisionSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === "owner_nudge.send_booking_link.decision");
    expect(decisionSpans).toHaveLength(2);
    expect(decisionSpans.map((s) => s.attributes["gca.approval.decision"]).sort()).toEqual([
      "approved",
      "rejected",
    ]);

    // Both calls fired independently — order-invariant since both entries
    // are the same literal string.
    expect(result.firedTags).toEqual(["send_booking_link", "send_booking_link"]);
  });

  it("does not gate get_pricing at all (no APPROVAL_GATES entry, so no nudge and no wait)", async () => {
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

  // Regression coverage for the bug documented in tracing.ts's Braintrust
  // attribute-namespace comment block (4th bullet), same class of bug section
  // 6d of docs/braintrust-online-eval-testing.md fixed for approval-gate.ts's
  // decision/no_reply spans: dispatchWantsHuman's/runMissingInfo's
  // owner_nudge.wants_human, owner_nudge.missing_info, and
  // missing_info.no_reply spans only ever carried gca.*-prefixed attributes,
  // none matching @braintrust/otel's FILTER_PREFIXES, so they were silently
  // dropped before export — confirmed absent from real Braintrust data (see
  // that doc's section 6a Bug 2). The tests above assert what this app's own
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

      braintrustProcessor.onEnd(findSpan("owner_nudge.missing_info"));

      expect(captured).toHaveLength(1);
    });

    it("lets the missing_info no_reply/timeout span through", async () => {
      // beforeEach already defaults step.waitForEvent to resolving null (a
      // timeout), driving runMissingInfo's no-reply fallback.
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

      braintrustProcessor.onEnd(findSpan("missing_info.no_reply"));

      expect(captured).toHaveLength(1);
    });

    // Confirmed rather than assumed, consistent with this suite's own
    // standing verification bar: this span's name already starts with
    // "gen_ai." (one of @braintrust/otel's own FILTER_PREFIXES — see
    // node_modules/@braintrust/otel/dist/index.js's isAISpan), so it should
    // clear the real filter on that alone, with no braintrust.*-prefixed
    // attribute needed the way the sibling nudge/no_reply spans above do.
    it("lets the missing_info execution span through, on its own gen_ai. name prefix", async () => {
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

    // send_booking_link's owner_nudge.send_booking_link/.decision/.no_reply spans
    // are now reparented to dispatchGatedToolCall's own toolAnchor instead of
    // the turn's own anchor (see that function's comment) — reparenting only
    // changes a span's parent context, not its own name/attributes, which is
    // all @braintrust/otel's isAISpan check inspects, so these three should
    // still clear the filter the same way they did before this change (via
    // their existing braintrust.tags/braintrust.approval_decision
    // attribute-prefix trick, established in section 6d) — confirmed here
    // against the real, reparented spans runAgentTurn actually emits now,
    // not assumed to still hold just because approval-gate.test.ts's own
    // (unreparented, fixed-anchor) equivalent block still passes.
    it("lets the send_booking_link nudge span through, reparented under its own tool-call span", async () => {
      step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
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

      await runAgentTurn(
        {
          conversationId: "convo-booking-filter",
          phone: "+351900000040",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("owner_nudge.send_booking_link"));

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

    it("lets the send_booking_link decision span through, reparented under its own tool-call span", async () => {
      step.waitForEvent.mockResolvedValueOnce({ data: { approved: false } });
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
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

      await runAgentTurn(
        {
          conversationId: "convo-booking-decision-filter",
          phone: "+351900000042",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-decision-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("owner_nudge.send_booking_link.decision"));

      expect(captured).toHaveLength(1);
    });

    it("lets the send_booking_link no_reply/timeout span through, reparented under its own tool-call span", async () => {
      // beforeEach already defaults step.waitForEvent to resolving null (a
      // timeout).
      generateTextMock
        .mockResolvedValueOnce(
          toolCallResponse([
            {
              toolName: "send_booking_link",
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

      await runAgentTurn(
        {
          conversationId: "convo-booking-timeout-filter",
          phone: "+351900000043",
          incomingMessage: "Book room 1 for Ana, Sep 1-5",
        },
        { correlationId: "corr-booking-timeout-filter", traceAnchor: TEST_TRACE_ANCHOR, step },
      );

      braintrustProcessor.onEnd(findSpan("owner_nudge.send_booking_link.no_reply"));

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
    spanExporter.reset();
    step = makeStepMock();
    step.waitForEvent.mockResolvedValue(null);
    loadMemoryMock.mockResolvedValue({
      historyMessages: [],
      memoryMessage: null,
    });
    loadPromptMock.mockResolvedValue({
      build: () => ({ messages: [{ role: "system", content: SYSTEM_PROMPT_TEXT }] }),
    });
    recordMessageMock.mockResolvedValue("msg-assistant-1");
    sendWhatsAppMessageMock.mockResolvedValue({ ok: true });
    updateSpanIOMock.mockResolvedValue(undefined);
    foldMemoryMock.mockResolvedValue(undefined);
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
      expect.arrayContaining([
        "update-turn-trace-io",
        "record-reply",
        "send-whatsapp-reply",
        "fold-memory-summary",
      ]),
    );
  });

  // The whole point of this fix: the summarizer's LLM round-trip must not
  // sit on the guest's reply-latency critical path. Asserting real call
  // order (not just presence in stepIds) is what actually proves that.
  it("runs fold-memory-summary strictly after send-whatsapp-reply, and awaits it before returning", async () => {
    generateTextMock.mockResolvedValueOnce(textResponse("Yes, room 1 is available!"));

    // Order of resolution: fold's own promise only settles after this flag
    // flips, so if the outer runGuestTurn call returned before actually
    // awaiting it, this assertion would still catch it via the "awaited
    // before returning" check below (foldMemoryMock is guaranteed called by
    // then, otherwise the array-order assertion on step.run's calls already
    // proves ordering independent of timing).
    let foldStarted = false;
    foldMemoryMock.mockImplementation(async () => {
      foldStarted = true;
    });

    await runGuestTurn({
      conversationId: "convo-fold-order",
      phone: "+351920742845",
      incomingMessage: "Is room 1 free?",
      correlationId: "corr-fold-order",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    // Real call order through step.run — send-whatsapp-reply (the guest's
    // actual delivery) strictly precedes fold-memory-summary.
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    const sendIndex = stepIds.indexOf("send-whatsapp-reply");
    const foldIndex = stepIds.indexOf("fold-memory-summary");
    expect(sendIndex).toBeGreaterThanOrEqual(0);
    expect(foldIndex).toBeGreaterThan(sendIndex);

    // runGuestTurn's own returned promise only resolved after foldMemory's
    // side effect actually ran — not a detached/orphaned promise.
    expect(foldStarted).toBe(true);
    expect(foldMemoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "convo-fold-order", phone: "+351920742845" }),
    );
  });

  // Verifies foldMemory's anchor is parented under a real span descended
  // from traceAnchor (the webhook root), NOT under the closed
  // "braintrust.guest_turn" span — see run-turn.ts's foldGuestMemory comment
  // for why it can't reuse that turn-scoped anchor anymore.
  it("passes foldMemory a traceAnchor rooted at traceAnchor, not the closed braintrust.guest_turn span", async () => {
    generateTextMock.mockResolvedValueOnce(textResponse("Yes, room 1 is available!"));

    await runGuestTurn({
      conversationId: "convo-fold-anchor",
      phone: "+351920742845",
      incomingMessage: "Is room 1 free?",
      correlationId: "corr-fold-anchor",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(foldMemoryMock).toHaveBeenCalledTimes(1);
    const [foldCall] = foldMemoryMock.mock.calls[0] as [
      { traceAnchor: { traceId: string; spanId: string } },
    ];
    expect(foldCall.traceAnchor.traceId).toBe(TEST_TRACE_ANCHOR.traceId);
    // A real, distinct span id — the "fold-memory-summary" step's own span,
    // not TEST_TRACE_ANCHOR.spanId (the webhook root itself) and not
    // guestTurnSpanId (the closed "braintrust.guest_turn" marker).
    expect(foldCall.traceAnchor.spanId).not.toBe(TEST_TRACE_ANCHOR.spanId);

    const foldSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "fold-memory-summary");
    expect(foldSpan).toBeDefined();
    expect(foldCall.traceAnchor.spanId).toBe(foldSpan?.spanContext().spanId);
  });

  it("marks the fold-memory-summary span failed but does not throw or block delivery when foldMemory rejects", async () => {
    generateTextMock.mockResolvedValueOnce(textResponse("Yes, room 1 is available!"));
    foldMemoryMock.mockRejectedValueOnce(new Error("summarizer boom"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // The guest already has their reply by the time fold runs — a fold
    // failure must never surface as a thrown error out of runGuestTurn.
    await expect(
      runGuestTurn({
        conversationId: "convo-fold-fail",
        phone: "+351920742845",
        incomingMessage: "Is room 1 free?",
        correlationId: "corr-fold-fail",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      }),
    ).resolves.toBeUndefined();

    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      "+351920742845",
      "Yes, room 1 is available!",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("foldMemory failed"),
      expect.any(Error),
    );
    const foldSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "fold-memory-summary");
    expect(foldSpan?.status.code).toBe(SpanStatusCode.ERROR);
    consoleErrorSpy.mockRestore();
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
        { toolName: "get_pricing", input: { room: "room1" }, toolCallId: "call_loop" },
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
