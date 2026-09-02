import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// missing-info.ts holds the full missing_info flow now: the tool schema/
// declaration, the shared event/timeout constants, the real suspend/resume
// dispatch (runMissingInfo — this app's run<ToolName> convention, see
// wants-human.test.ts for the sibling coverage this mirrors), and both
// non-step branches of what happens once a nudge is settled — reply arrives
// (handleMissingInfoReplyReceived) or doesn't (handleMissingInfoNoReply).
//
// Same in-memory OTel wiring as wants-human.test.ts/approval-gate.test.ts,
// so runMissingInfo's span assertions below inspect a real span's
// attributes instead of a no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// Mocks every real external boundary this file touches: Postgres (the
// documents insert AND runMissingInfo's own missing_info_trace_anchors
// insert — see recordMissingInfoTraceAnchor's own best-effort/try-catch
// doc comment in tracing.ts for why an unhandled table would otherwise only
// log, not throw, but stubbing it keeps this suite's output clean), the
// embedding call, inngest.send, telegram-router (the owner nudge send),
// pending_owner_decisions bookkeeping, and tracing.ts's updateSpanIO (a real
// fetch() to Braintrust's REST API) — everything else in tracing.ts (like
// steppedSpan, recordMissingInfoTraceAnchor's own span-side calls) stays
// real.
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockDocInsert = vi.fn(() => ({ select: mockSelect }));
const mockTraceAnchorInsert = vi.fn(() => Promise.resolve({ error: null }));

const mockFrom = vi.fn((table: string) => {
  if (table === "documents") return { insert: mockDocInsert };
  if (table === "missing_info_trace_anchors") return { insert: mockTraceAnchorInsert };
  throw new Error(`missing-info.test.ts mockFrom: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const embedMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, embed: embedMock };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: (model: string) => model }),
}));

const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock },
}));

const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const insertPendingOwnerDecisionMock = vi.fn();
const resolvePendingOwnerDecisionByCorrelationIdMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  insertPendingOwnerDecision: insertPendingOwnerDecisionMock,
  resolvePendingOwnerDecisionByCorrelationId: resolvePendingOwnerDecisionByCorrelationIdMock,
}));

const updateSpanIOMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  return { ...actual, updateSpanIO: updateSpanIOMock };
});

const {
  handleMissingInfoNoReply,
  handleMissingInfoReplyReceived,
  OWNER_NUDGE_ANSWERED_EVENT,
  runMissingInfo,
} = await import("@/agent/tools/missing-info.js");

const MISSING_INFO_REPLY_TIMEOUT = "24h";
const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

describe("handleMissingInfoNoReply", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves after logging — no DB side effects", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handleMissingInfoNoReply({ correlationId: "corr-abc-123" }),
    ).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("corr-abc-123"));
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(MISSING_INFO_REPLY_TIMEOUT),
    );
    expect(mockFrom).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe("handleMissingInfoReplyReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    mockSingle.mockResolvedValue({ data: { id: 42 }, error: null });
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  it("embeds the answer, inserts into documents, then sends the owner-nudge-answered event with the correlation id", async () => {
    await expect(
      handleMissingInfoReplyReceived({
        correlationId: "corr-abc-123",
        answer: "The AC is above the bed",
      }),
    ).resolves.toEqual({ documentId: 42, embeddingDimensions: 3 });

    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "The AC is above the bed" }),
    );
    expect(mockFrom).toHaveBeenCalledWith("documents");
    expect(mockDocInsert).toHaveBeenCalledWith({
      content: "The AC is above the bed",
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      metadata: { source: "owner_nudge_answer" },
    });
    expect(mockSelect).toHaveBeenCalledWith("id");

    // Order matters (per the app owner): the KB embed/insert must happen
    // BEFORE the event that wakes a suspended run is sent. mockSingle is the
    // call that actually resolves the insert (insert()/select() just build
    // the chain synchronously), so it's the right proxy for "insert done."
    const docInsertOrder = mockSingle.mock.invocationCallOrder[0];
    const sendOrder = inngestSendMock.mock.invocationCallOrder[0];
    expect(docInsertOrder).toBeLessThan(sendOrder);

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: OWNER_NUDGE_ANSWERED_EVENT,
      data: { correlationId: "corr-abc-123", answer: "The AC is above the bed" },
    });
  });

  it("throws when the documents insert fails, before touching inngest.send", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "insert boom" } });

    await expect(
      handleMissingInfoReplyReceived({
        correlationId: "corr-abc-123",
        answer: "The AC is above the bed",
      }),
    ).rejects.toThrow("insert boom");

    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("rethrows an inngest.send failure rather than swallowing it — there's no equivalent to DBOS's 'workflow doesn't exist' case to catch", async () => {
    inngestSendMock.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      handleMissingInfoReplyReceived({
        correlationId: "corr-abc-123",
        answer: "The AC is above the bed",
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("runMissingInfo", () => {
  type StepTools = GetStepTools<typeof inngest>;

  // Only `run`/`waitForEvent` are exercised by real code here — see
  // approval-gate.test.ts's own makeStepMock comment for why the rest of the
  // real StepTools surface is cast away rather than stubbed out.
  function makeStepMock() {
    return {
      run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
      waitForEvent: vi.fn(),
    } as unknown as StepTools & {
      run: ReturnType<typeof vi.fn>;
      waitForEvent: ReturnType<typeof vi.fn>;
    };
  }

  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    step = makeStepMock();
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
    insertPendingOwnerDecisionMock.mockResolvedValue(undefined);
    resolvePendingOwnerDecisionByCorrelationIdMock.mockResolvedValue(undefined);
    mockTraceAnchorInsert.mockResolvedValue({ error: null });
  });

  it("sends the owner nudge with the model's reason under reasonCategory 'missing_info', carrying the correlationId", async () => {
    step.waitForEvent.mockResolvedValueOnce({
      data: { correlationId: "corr-1", answer: "The AC is above the bed" },
    });

    await runMissingInfo(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "convo-1",
        phone: "+3519",
        reason: "Where is the AC unit?",
        reasonCategory: "missing_info",
        correlationId: "corr-1",
      }),
    );
  });

  it("returns the owner's answer when it arrives within the timeout, and never re-embeds (that already happened in handleMissingInfoReplyReceived)", async () => {
    step.waitForEvent.mockResolvedValueOnce({
      data: { correlationId: "corr-1", answer: "The AC is above the bed" },
    });

    await expect(
      runMissingInfo(
        { reason: "Where is the AC unit?" },
        {
          conversationId: "convo-1",
          phone: "+3519",
          correlationId: "corr-1",
          traceAnchor: TEST_TRACE_ANCHOR,
          step,
        },
      ),
    ).resolves.toEqual({ escalated: true, answer: "The AC is above the bed" });

    expect(embedMock).not.toHaveBeenCalled();
    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-1",
      "answered",
    );
  });

  it("falls back to the owner-notified message and resolves the pending decision as 'timeout' when step.waitForEvent times out", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    await expect(
      runMissingInfo(
        { reason: "Where is the AC unit?" },
        {
          conversationId: "convo-1",
          phone: "+3519",
          correlationId: "corr-1",
          traceAnchor: TEST_TRACE_ANCHOR,
          step,
        },
      ),
    ).resolves.toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });

    expect(resolvePendingOwnerDecisionByCorrelationIdMock).toHaveBeenCalledWith(
      "corr-1",
      "timeout",
    );
  });

  it("skips step.waitForEvent entirely and returns the honest fallback message when the nudge itself failed to send", async () => {
    sendOwnerNudgeMock.mockResolvedValue({ ok: false, error: "telegram-router down" });

    await expect(
      runMissingInfo(
        { reason: "Where is the AC unit?" },
        {
          conversationId: "convo-1",
          phone: "+3519",
          correlationId: "corr-1",
          traceAnchor: TEST_TRACE_ANCHOR,
          step,
        },
      ),
    ).resolves.toEqual({
      escalated: true,
      message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
    });

    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(insertPendingOwnerDecisionMock).not.toHaveBeenCalled();
  });

  it("creates the gen_ai.tool.missing_info execution span first, nested nudge span, and step order for the answered path", async () => {
    step.waitForEvent.mockResolvedValueOnce({
      data: { correlationId: "corr-1", answer: "The AC is above the bed" },
    });

    await runMissingInfo(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(step.run.mock.calls.map((call) => call[0])).toEqual([
      "tool-missing_info",
      "record-missing-info-trace-anchor",
      "owner-nudge-missing-info",
      "record-pending-decision",
      "missing-info-answer-received",
      "resolve-pending-decision",
      "update-missing-info-trace-io",
    ]);
    expect(step.waitForEvent).toHaveBeenCalledWith(
      "wait-for-owner-answer",
      expect.objectContaining({
        event: OWNER_NUDGE_ANSWERED_EVENT,
        match: "data.correlationId",
        timeout: MISSING_INFO_REPLY_TIMEOUT,
      }),
    );

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.missing_info");
    expect(execSpan?.attributes["gen_ai.tool.name"]).toBe("missing_info");
    expect(execSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Where is the AC unit?" }),
    );
    // output isn't known until after the nudge/wait resolves, well after
    // this span has already closed, so it's patched in retroactively via
    // updateSpanIO instead — never set directly as a span attribute.
    expect(execSpan?.attributes["gca.tool.output"]).toBeUndefined();

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.missing_info");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["missing_info"]);

    const answeredSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "missing_info.answer_received");
    expect(answeredSpan).toBeDefined();

    expect(updateSpanIOMock).toHaveBeenCalledWith(execSpan?.spanContext().spanId, {
      output: { escalated: true, answer: "The AC is above the bed" },
    });
  });

  it("creates the missing_info.no_reply span and runs handleMissingInfoNoReply's fallback when the wait times out", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runMissingInfo(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(step.run.mock.calls.map((call) => call[0])).toEqual([
      "tool-missing_info",
      "record-missing-info-trace-anchor",
      "owner-nudge-missing-info",
      "record-pending-decision",
      "missing-info-no-reply",
      "resolve-pending-decision-timeout",
      "update-missing-info-trace-io",
    ]);

    const noReplySpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "missing_info.no_reply");
    expect(noReplySpan?.attributes["gca.timeout"]).toBe(MISSING_INFO_REPLY_TIMEOUT);
    // handleMissingInfoNoReply's own log, not a duplicate — confirms the
    // real fallback function ran (not a stub) inside the no_reply span's step.
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("corr-1"));

    consoleWarnSpy.mockRestore();
  });
});
