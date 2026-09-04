import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// missing-info.ts holds the full missing_info flow: the tool schema/
// declaration, the shared event/timeout constants, the real suspend/resume
// dispatch (requestMissingInfoApproval — this app's run<ToolName>
// convention, see wants-human.test.ts for the sibling coverage this
// mirrors), the post-approval execution half (runMissingInfo — a genuine
// one-shot dispatch, same shape a plain tool's own run<ToolName> has), and
// both non-step branches of what happens once a nudge is settled — reply
// arrives (handleMissingInfoReplyReceived) or doesn't
// (handleMissingInfoNoReply).
//
// Same in-memory OTel wiring as wants-human.test.ts/approval-gate.test.ts,
// so requestMissingInfoApproval's span assertions below inspect a real
// span's attributes instead of a no-op.
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
  requestMissingInfoApproval,
  runMissingInfo,
} = await import("@/agent/tools/missing-info.js");

const MISSING_INFO_REPLY_TIMEOUT = "24h";
const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

type StepTools = GetStepTools<typeof inngest>;

// Only `run`/`waitForEvent` are exercised by real code here — see
// approval-gate.test.ts's own makeStepMock comment for why the rest of the
// real StepTools surface is cast away rather than stubbed out. Shared by
// every describe block below that drives requestMissingInfoApproval.
function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    waitForEvent: vi.fn(),
  } as unknown as StepTools & {
    run: ReturnType<typeof vi.fn>;
    waitForEvent: ReturnType<typeof vi.fn>;
  };
}

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

describe("requestMissingInfoApproval / runMissingInfo", () => {
  // The two halves of missing_info's dispatch — see missing-info.ts's own
  // comment on the split. Covers the HitlDecision shape directly; the
  // span/step-order assertions for the full approve-then-execute sequence
  // (as run-tool.ts's runTool + run-agent-turn.ts's loop actually drive it)
  // live in tests/agent/run-agent-turn.test.ts, not duplicated here.
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

  it("resolves approved: true with the owner's answer as payload when it arrives in time", async () => {
    step.waitForEvent.mockResolvedValueOnce({
      data: { correlationId: "corr-1", answer: "The AC is above the bed" },
    });

    const decision = await requestMissingInfoApproval(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(decision.approved).toBe(true);
    expect(decision.payload).toBe("The AC is above the bed");
    expect(decision.hitlSpanId).toEqual(expect.any(String));
    expect(decision.notApprovedOutput).toBeUndefined();
  });

  it("resolves approved: false with the honest not-reached fallback when the nudge fails to send", async () => {
    sendOwnerNudgeMock.mockResolvedValue({ ok: false, error: "telegram-router down" });

    const decision = await requestMissingInfoApproval(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(decision.approved).toBe(false);
    expect(decision.payload).toBeUndefined();
    expect(decision.notApprovedOutput).toEqual({
      escalated: true,
      message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
    });
  });

  it("resolves approved: false with the owner-notified fallback (not the not-reached one) on a timeout", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    const decision = await requestMissingInfoApproval(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(decision.approved).toBe(false);
    expect(decision.notApprovedOutput).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
  });

  it("creates the hitl.missing_info gate span first, as the nudge/answer-received spans' real parent — no gen_ai.tool.missing_info span exists on this path", async () => {
    step.waitForEvent.mockResolvedValueOnce({
      data: { correlationId: "corr-1", answer: "The AC is above the bed" },
    });

    await requestMissingInfoApproval(
      { reason: "Where is the AC unit?" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(step.run.mock.calls.map((c) => c[0])[0]).toBe("hitl-missing_info");
    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.missing_info");
    expect(hitlSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Where is the AC unit?" }),
    );
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "hitl.missing_info.nudge"),
    ).toBeDefined();
    expect(
      spanExporter
        .getFinishedSpans()
        .find((span) => span.name === "hitl.missing_info.answer_received"),
    ).toBeDefined();
    // The real execution span only gets created by runMissingInfo, once
    // run-tool.ts's runTool is actually called with the approved decision —
    // requestMissingInfoApproval on its own never creates one.
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.tool.missing_info"),
    ).toBeUndefined();
  });

  it("runMissingInfo embeds the approval's payload into its result — args unused, only the answer matters", async () => {
    await expect(
      runMissingInfo(
        { reason: "Where is the AC unit?" },
        { conversationId: "convo-1", phone: "+3519", traceAnchor: TEST_TRACE_ANCHOR, step },
        "The AC is above the bed",
      ),
    ).resolves.toEqual({
      escalated: true,
      answer: "The AC is above the bed",
    });
  });

  it("runMissingInfo creates its own fresh gen_ai.tool.missing_info execution span with real output known at creation, no updateSpanIO patch", async () => {
    const result = await runMissingInfo(
      { reason: "Where is the AC unit?" },
      { conversationId: "convo-1", phone: "+3519", traceAnchor: TEST_TRACE_ANCHOR, step },
      "The AC is above the bed",
    );

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.missing_info");
    expect(execSpan).toBeDefined();
    expect(execSpan?.attributes["gen_ai.tool.name"]).toBe("missing_info");
    expect(execSpan?.attributes["gca.tool.output"]).toBe(JSON.stringify(result));
    expect(updateSpanIOMock).not.toHaveBeenCalled();
  });
});
