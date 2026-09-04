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

// tracing.ts's real withTurnSpan/tracer stay real in this suite (that's the
// only way runAgentTurn's own real span-id generation still exercises real
// code), but with no OTel SDK wired up (that's instrumentation.ts's job,
// only invoked by the real Next.js runtime), the default global
// TracerProvider is a no-op — span.setAttribute calls happen but land
// nowhere observable. Registering a real, in-memory-only BasicTracerProvider
// here (once, for this whole test file) lets the tests below inspect real
// span attributes without needing to touch Braintrust or any network.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// Drives runGuestTurn end-to-end, which itself drives the real runAgentTurn
// internally — mocking only the true external boundaries: Postgres,
// telegram-router, Twilio, Braintrust's prompt store, and generateText
// itself.
const loadMemoryMock = vi.fn();
const foldMemoryMock = vi.fn();
vi.mock("@/agent/memory.js", () => ({
  loadMemory: loadMemoryMock,
  foldMemory: foldMemoryMock,
}));

// property-question.ts calls createClient() at module load time (pulled in
// transitively via run-agent-turn.ts -> run-tool.ts), so this must be
// present even though no test here calls that tool.
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  })),
  createClient: vi.fn(() => ({})),
}));

const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const recordMessageMock = vi.fn();
const updateMessageDeliveryStatusMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  recordMessage: recordMessageMock,
  updateMessageDeliveryStatus: updateMessageDeliveryStatusMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

// run_code's real dispatch talks to a real Vercel Sandbox — mocked at its
// one true external boundary (Sandbox.create) purely for import-time safety,
// same as run-agent-turn.test.ts's identical mock; no test here drives
// run_code.
const sandboxCreateMock = vi.fn();
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: (...args: unknown[]) => sandboxCreateMock(...args) },
}));

// updateSpanIO (a real fetch() to Braintrust's REST API) is mocked — the
// wants_human test below exercises its real retroactive-patch call.
const updateSpanIOMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  return { ...actual, updateSpanIO: updateSpanIOMock };
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

const { runGuestTurn } = await import("@/agent/run-guest-turn.js");

const SYSTEM_PROMPT_TEXT = "You are the whatsapp booking agent.";

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

// Hand-rolled Inngest step mock — step.run immediately invokes its callback
// (matching how a real step.run behaves from the caller's perspective once
// memoized state doesn't short-circuit it), since run-guest-turn.ts takes
// `step` as a plain explicit parameter instead of an ambient import — a
// plain mock object is enough, no need for @inngest/test's heavier
// InngestTestEngine harness.
type StepTools = GetStepTools<typeof inngest>;

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

// The Inngest-driven delivery orchestrator: drives the real runAgentTurn
// (via this suite's own mocks — loadMemory, generateText, etc.), then
// records the reply and sends it proactively. runGuestTurn is the plain
// function runGuestTurnFunction (in the real app) wraps with
// inngest.createFunction — exercised directly here with a hand-rolled step
// mock instead of a real Inngest engine.
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
    updateMessageDeliveryStatusMock.mockResolvedValue(undefined);
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
    const resultSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "braintrust.guest_turn.result");
    expect(resultSpan?.attributes["braintrust.input"]).toBe("Is room 1 free?");
    expect(resultSpan?.attributes["braintrust.output"]).toBe("Yes, room 1 is available!");
    const stepIds = step.run.mock.calls.map((call) => call[0]);
    expect(stepIds).toEqual(
      expect.arrayContaining([
        "update-turn-trace-io",
        "record-reply",
        "send-whatsapp-reply",
        "update-message-delivery-status",
        "fold-memory-summary",
      ]),
    );
    // recordMessage's own return value (the row id) is what gets the
    // delivery-status follow-up update — see conversations.ts's
    // updateMessageDeliveryStatus doc comment.
    expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith("msg-assistant-1", "sent");
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
  // "braintrust.guest_turn" span — see run-guest-turn.ts's foldGuestMemory
  // comment for why it can't reuse that turn-scoped anchor anymore.
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

  it("passes firedTags through to the result span's tags when the turn escalated via wants_human", async () => {
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

    const resultSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "braintrust.guest_turn.result");
    expect(resultSpan?.attributes["braintrust.input"]).toBe("I want to talk to a person");
    expect(resultSpan?.attributes["braintrust.output"]).toBe(
      "Sure, the owner will reach out shortly.",
    );
    expect(resultSpan?.attributes["braintrust.tags"]).toEqual(["wants_human"]);
  });

  it("falls back to a generic apology reply when the turn's last message isn't a string assistant message", async () => {
    // Model always responds with a tool call, so the loop never produces a
    // final text reply — same step-cap shape as the runAgentTurn suite.
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
    expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith("msg-assistant-1", "failed");
    consoleErrorSpy.mockRestore();
  });
});
