import type { GetStepTools } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// Mocks every real external boundary: Postgres (documents insert only —
// there's no escalations table anymore), the embedding call, telegram-router,
// and inngest.send. step is a hand-rolled mock (run/waitForEvent), matching
// how @dbos-inc/dbos-sdk used to be hand-mocked — run-turn.ts now threads
// `step` in as a plain explicit parameter instead of an ambient import, so a
// plain mock object is enough; no need for @inngest/test's heavier harness.
const mockDocInsert = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === "documents") return { insert: mockDocInsert };
  throw new Error(`missing-info.test.ts mockFrom: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
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

const {
  runMissingInfo,
  waitForMissingInfoReply,
  handleMissingInfoNoReply,
  handleMissingInfoReplyReceived,
  OWNER_NUDGE_ANSWERED_EVENT,
} = await import("@/agent/tools/missing-info.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

const toolContextBase = {
  conversationId: "convo-1",
  phone: "+351920742845",
  traceAnchor: TEST_TRACE_ANCHOR,
};

const MISSING_INFO_REPLY_TIMEOUT = "24h";

type StepTools = GetStepTools<typeof inngest>;

// Only `run`/`waitForEvent` are exercised by real code here — the rest of
// the real StepTools surface is cast away rather than stubbed out, since
// nothing under test calls it.
function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    waitForEvent: vi.fn(),
  } as unknown as StepTools & {
    run: ReturnType<typeof vi.fn>;
    waitForEvent: ReturnType<typeof vi.fn>;
  };
}

describe("waitForMissingInfoReply", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    step = makeStepMock();
  });

  it("calls step.waitForEvent with the owner-nudge-answered event, matching on data.correlationId, and the configured timeout, returning a real answer as-is", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { answer: "The AC is above the bed" } });

    const result = await waitForMissingInfoReply({
      step,
      correlationId: "corr-abc-123",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(step.waitForEvent).toHaveBeenCalledWith("wait-for-owner-answer", {
      event: OWNER_NUDGE_ANSWERED_EVENT,
      match: "data.correlationId",
      timeout: MISSING_INFO_REPLY_TIMEOUT,
    });
    expect(result).toBe("The AC is above the bed");
  });

  it("returns null and calls handleMissingInfoNoReply when step.waitForEvent times out (resolves null)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await waitForMissingInfoReply({
      step,
      correlationId: "corr-abc-123",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("corr-abc-123"));
    consoleWarnSpy.mockRestore();
  });
});

describe("handleMissingInfoNoReply", () => {
  it("resolves after logging — no DB side effects (see waitForMissingInfoReply, the only real caller)", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handleMissingInfoNoReply({ correlationId: "corr-abc-123" }),
    ).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("corr-abc-123"));
    expect(mockFrom).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe("runMissingInfo", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    step = makeStepMock();
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("step 1 (real): sends the Telegram nudge exactly like the other owner-nudge tools", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, { ...toolContextBase, step });

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+351920742845",
        reason: "Guest asked about the AC",
        reasonCategory: "missing_info",
        conversationId: "convo-1",
      }),
    );
  });

  it("reads context.correlationId and passes it through to requestOwnerNudge when set", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    await runMissingInfo(
      { reason: "Guest asked about the AC" },
      { ...toolContextBase, step, correlationId: "corr-abc-123" },
    );

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "corr-abc-123" }),
    );
  });

  it("passes correlationId: undefined when context.correlationId is undefined (no live run context)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, { ...toolContextBase, step });

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: undefined }),
    );
  });

  it("returns the answer directly as its own tool result when step.waitForEvent resolves with a real answer — no re-embedding at this call site", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { answer: "The AC is above the bed" } });

    const result = await runMissingInfo(
      { reason: "Guest asked about the AC" },
      { ...toolContextBase, step },
    );

    expect(result).toEqual({ escalated: true, answer: "The AC is above the bed" });
    // The embedding already happened on the resolve-route side (see
    // handleMissingInfoReplyReceived's own tests below) BEFORE the
    // owner-nudge-answered event delivered this answer here — runMissingInfo
    // must not re-embed.
    expect(embedMock).not.toHaveBeenCalled();
    expect(mockDocInsert).not.toHaveBeenCalled();
  });

  it("falls back to the owner-notified response when step.waitForEvent times out (resolves null)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runMissingInfo(
      { reason: "Guest asked about the AC" },
      { ...toolContextBase, step },
    );

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    consoleWarnSpy.mockRestore();
  });

  it("skips the step.waitForEvent wait entirely (and still returns the fallback message) when the nudge itself failed", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runMissingInfo(
      { reason: "Guest asked about the AC" },
      { ...toolContextBase, step },
    );

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    // Nudge failed means nothing to wait on — step.waitForEvent is never called.
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });
});

describe("handleMissingInfoReplyReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    mockDocInsert.mockResolvedValue({ error: null });
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  it("embeds the answer, inserts into documents, then sends the owner-nudge-answered event with the correlation id", async () => {
    await handleMissingInfoReplyReceived({
      correlationId: "corr-abc-123",
      answer: "The AC is above the bed",
    });

    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "The AC is above the bed" }),
    );
    expect(mockFrom).toHaveBeenCalledWith("documents");
    expect(mockDocInsert).toHaveBeenCalledWith({
      content: "The AC is above the bed",
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      metadata: { source: "owner_nudge_answer" },
    });

    // Order matters (per the app owner): the KB embed/insert must happen
    // BEFORE the event that wakes a suspended run is sent.
    const docInsertOrder = mockDocInsert.mock.invocationCallOrder[0];
    const sendOrder = inngestSendMock.mock.invocationCallOrder[0];
    expect(docInsertOrder).toBeLessThan(sendOrder);

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: OWNER_NUDGE_ANSWERED_EVENT,
      data: { correlationId: "corr-abc-123", answer: "The AC is above the bed" },
    });
  });

  it("throws when the documents insert fails, before touching inngest.send", async () => {
    mockDocInsert.mockResolvedValueOnce({ error: { message: "insert boom" } });

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
