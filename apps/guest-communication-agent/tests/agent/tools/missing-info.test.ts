import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks every real external boundary: Postgres (documents insert only —
// there's no escalations table anymore), the embedding call, and DBOS
// itself (DBOS.recv/send/workflowID/Error).
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

// Mirrors the real @dbos-inc/dbos-sdk shape closely enough for
// `err instanceof DBOSErrors.DBOSNonExistentWorkflowError` to work.
class DBOSNonExistentWorkflowError extends Error {}

let mockDbosWorkflowId: string | undefined;
const dbosRecvMock = vi.fn();
const dbosSendMock = vi.fn();
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    get workflowID() {
      return mockDbosWorkflowId;
    },
    recv: dbosRecvMock,
    send: dbosSendMock,
  },
  Error: { DBOSNonExistentWorkflowError },
}));

const {
  runMissingInfo,
  waitForMissingInfoReply,
  handleMissingInfoNoReply,
  handleMissingInfoReplyReceived,
} = await import("@/agent/tools/missing-info.js");

const toolContext = { conversationId: "convo-1", phone: "+351920742845" };

const MISSING_INFO_REPLY_TOPIC = "missing_info_reply";
const MISSING_INFO_REPLY_TIMEOUT_SECONDS = 24 * 60 * 60;

describe("waitForMissingInfoReply", () => {
  beforeEach(() => {
    dbosRecvMock.mockReset();
  });

  it("calls DBOS.recv with the missing_info_reply topic and the configured timeout, returning a real answer as-is", async () => {
    dbosRecvMock.mockResolvedValueOnce("The AC is above the bed");

    const result = await waitForMissingInfoReply("wf-abc-123");

    expect(dbosRecvMock).toHaveBeenCalledWith(
      MISSING_INFO_REPLY_TOPIC,
      MISSING_INFO_REPLY_TIMEOUT_SECONDS,
    );
    expect(result).toBe("The AC is above the bed");
  });

  it("returns null and calls handleMissingInfoNoReply when DBOS.recv times out (resolves null)", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await waitForMissingInfoReply("wf-abc-123");

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("wf-abc-123"));
    consoleWarnSpy.mockRestore();
  });
});

describe("handleMissingInfoNoReply", () => {
  it("resolves after logging — no DB/DBOS side effects (see waitForMissingInfoReply, the only real caller)", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(handleMissingInfoNoReply("wf-abc-123")).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("wf-abc-123"));
    expect(mockFrom).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe("runMissingInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbosWorkflowId = undefined;
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("step 1 (real): sends the Telegram nudge exactly like the other owner-nudge tools", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+351920742845",
        reason: "Guest asked about the AC",
        reasonCategory: "missing_info",
        conversationId: "convo-1",
      }),
    );
  });

  it("reads DBOS.workflowID and passes it through to requestOwnerNudge when set", async () => {
    mockDbosWorkflowId = "wf-abc-123";
    dbosRecvMock.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-abc-123" }),
    );
  });

  it("passes workflowId: undefined when DBOS.workflowID is undefined (no live workflow context)", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: undefined }),
    );
  });

  it("returns the answer directly as its own tool result when DBOS.recv resolves with a real answer — no re-embedding at this call site", async () => {
    dbosRecvMock.mockResolvedValueOnce("The AC is above the bed");

    const result = await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(result).toEqual({ escalated: true, answer: "The AC is above the bed" });
    // The embedding already happened on the resolve-route side (see
    // handleMissingInfoReplyReceived's own tests below) BEFORE DBOS.send
    // delivered this answer here — runMissingInfo must not re-embed.
    expect(embedMock).not.toHaveBeenCalled();
    expect(mockDocInsert).not.toHaveBeenCalled();
  });

  it("falls back to the owner-notified response when DBOS.recv times out (resolves null)", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    consoleWarnSpy.mockRestore();
  });

  it("skips the DBOS.recv wait entirely (and still returns the fallback message) when the nudge itself failed", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    // Nudge failed means nothing to wait on — DBOS.recv is never called.
    expect(dbosRecvMock).not.toHaveBeenCalled();
  });
});

describe("handleMissingInfoReplyReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    mockDocInsert.mockResolvedValue({ error: null });
  });

  it("embeds the answer, inserts into documents, then calls DBOS.send with the workflow id and returns resumed:true", async () => {
    const result = await handleMissingInfoReplyReceived({
      workflowId: "wf-abc-123",
      answer: "The AC is above the bed",
    });

    expect(result).toEqual({ resumed: true });
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
    // BEFORE DBOS.send wakes the workflow.
    const docInsertOrder = mockDocInsert.mock.invocationCallOrder[0];
    const sendOrder = dbosSendMock.mock.invocationCallOrder[0];
    expect(docInsertOrder).toBeLessThan(sendOrder);

    expect(dbosSendMock).toHaveBeenCalledWith(
      "wf-abc-123",
      "The AC is above the bed",
      MISSING_INFO_REPLY_TOPIC,
    );
  });

  it("throws when the documents insert fails, before touching DBOS.send", async () => {
    mockDocInsert.mockResolvedValueOnce({ error: { message: "insert boom" } });

    await expect(
      handleMissingInfoReplyReceived({
        workflowId: "wf-abc-123",
        answer: "The AC is above the bed",
      }),
    ).rejects.toThrow("insert boom");

    expect(dbosSendMock).not.toHaveBeenCalled();
  });

  it("returns resumed:false (without throwing) when DBOS.send reports the workflow no longer exists — a duplicate/late reply", async () => {
    dbosSendMock.mockRejectedValueOnce(
      new DBOSNonExistentWorkflowError("Sent to non-existent destination workflow UUID: wf-gone"),
    );
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await handleMissingInfoReplyReceived({
      workflowId: "wf-gone",
      answer: "The AC is above the bed",
    });

    expect(result).toEqual({ resumed: false });
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("wf-gone"));
    consoleWarnSpy.mockRestore();
  });

  it("rethrows any other DBOS.send failure rather than swallowing it", async () => {
    dbosSendMock.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      handleMissingInfoReplyReceived({
        workflowId: "wf-abc-123",
        answer: "The AC is above the bed",
      }),
    ).rejects.toThrow("connection reset");
  });
});
