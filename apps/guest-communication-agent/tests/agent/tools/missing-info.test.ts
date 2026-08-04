import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks every real external boundary: Postgres (routed by table name),
// the embedding call, and DBOS itself (DBOS.recv/send/workflowID).
const mockEscSingle = vi.fn();
const mockEscSelect = vi.fn(() => ({ single: mockEscSingle }));
const mockEscInsert = vi.fn((_row: Record<string, unknown>) => ({ select: mockEscSelect }));
const mockEscEq = vi.fn();
const mockEscUpdate = vi.fn(() => ({ eq: mockEscEq }));

const mockDocInsert = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === "escalations") return { insert: mockEscInsert, update: mockEscUpdate };
  if (table === "documents") return { insert: mockDocInsert };
  throw new Error(`missing-info.test.ts mockFrom: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
}));

const embedMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, embed: embedMock };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: (model: string) => model }),
}));

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

    const result = await waitForMissingInfoReply("esc-1");

    expect(dbosRecvMock).toHaveBeenCalledWith(
      MISSING_INFO_REPLY_TOPIC,
      MISSING_INFO_REPLY_TIMEOUT_SECONDS,
    );
    expect(result).toBe("The AC is above the bed");
  });

  it("returns null and calls handleMissingInfoNoReply when DBOS.recv times out (resolves null)", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await waitForMissingInfoReply("esc-1");

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("esc-1"));
    consoleWarnSpy.mockRestore();
  });
});

describe("handleMissingInfoNoReply", () => {
  it("resolves after logging — no DB/DBOS side effects (see waitForMissingInfoReply, the only real caller)", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(handleMissingInfoNoReply("esc-1")).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("esc-1"));
    expect(mockFrom).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe("runMissingInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbosWorkflowId = undefined;
    mockEscSingle.mockResolvedValue({ data: { id: "esc-1" }, error: null });
    mockEscEq.mockResolvedValue({ error: null });
    sendEscalationNudgeMock.mockResolvedValue({ ok: true, telegramMessageId: 4242 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("step 1 (real): inserts the escalation and sends the Telegram nudge exactly like the other escalation tools", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(mockFrom).toHaveBeenCalledWith("escalations");
    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "convo-1",
        phone_number: "+351920742845",
        reason: "Guest asked about the AC",
        reason_category: "missing_info",
      }),
    );
    expect(sendEscalationNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ escalationId: "esc-1", reasonCategory: "missing_info" }),
    );
  });

  it("reads DBOS.workflowID and includes it as workflow_id in the escalation insert when set", async () => {
    mockDbosWorkflowId = "wf-abc-123";
    dbosRecvMock.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(mockEscInsert).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: "wf-abc-123" }),
    );
  });

  it("omits workflow_id from the escalation insert when DBOS.workflowID is undefined (no live workflow context)", async () => {
    dbosRecvMock.mockResolvedValueOnce(null);

    await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    const insertArg = mockEscInsert.mock.calls[0][0];
    expect(insertArg).not.toHaveProperty("workflow_id");
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

  it("skips the DBOS.recv wait entirely (and still returns the fallback message) when the escalation insert itself failed", async () => {
    mockEscSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    // No escalation id means nothing to wait on — DBOS.recv is never called.
    expect(dbosRecvMock).not.toHaveBeenCalled();
  });
});

describe("handleMissingInfoReplyReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    mockDocInsert.mockResolvedValue({ error: null });
    mockEscEq.mockResolvedValue({ error: null });
  });

  it("embeds the answer, inserts into documents, and resolves the escalation, then calls DBOS.send with the workflow id and returns resumed:true", async () => {
    const result = await handleMissingInfoReplyReceived({
      escalationId: "esc-1",
      answer: "The AC is above the bed",
      workflowId: "wf-abc-123",
    });

    expect(result).toEqual({ resumed: true });
    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "The AC is above the bed" }),
    );
    expect(mockFrom).toHaveBeenCalledWith("documents");
    expect(mockDocInsert).toHaveBeenCalledWith({
      content: "The AC is above the bed",
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      metadata: { source: "owner_escalation_answer", escalation_id: "esc-1" },
    });
    expect(mockEscUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "The AC is above the bed" }),
    );
    expect(mockEscEq).toHaveBeenCalledWith("id", "esc-1");

    // Order matters (per the app owner): the KB embed/insert and escalation
    // resolution must both happen BEFORE DBOS.send wakes the workflow.
    const docInsertOrder = mockDocInsert.mock.invocationCallOrder[0];
    const escUpdateOrder = mockEscUpdate.mock.invocationCallOrder[0];
    const sendOrder = dbosSendMock.mock.invocationCallOrder[0];
    expect(docInsertOrder).toBeLessThan(sendOrder);
    expect(escUpdateOrder).toBeLessThan(sendOrder);

    expect(dbosSendMock).toHaveBeenCalledWith(
      "wf-abc-123",
      "The AC is above the bed",
      MISSING_INFO_REPLY_TOPIC,
    );
  });

  it("still embeds and resolves the escalation, but skips DBOS.send and returns resumed:false, when workflowId is null", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleMissingInfoReplyReceived({
      escalationId: "esc-1",
      answer: "The AC is above the bed",
      workflowId: null,
    });

    expect(result).toEqual({ resumed: false });
    expect(mockDocInsert).toHaveBeenCalled();
    expect(mockEscUpdate).toHaveBeenCalled();
    expect(dbosSendMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("esc-1"));

    consoleErrorSpy.mockRestore();
  });

  it("throws when the documents insert fails, before touching the escalations update or DBOS.send", async () => {
    mockDocInsert.mockResolvedValueOnce({ error: { message: "insert boom" } });

    await expect(
      handleMissingInfoReplyReceived({
        escalationId: "esc-1",
        answer: "The AC is above the bed",
        workflowId: "wf-abc-123",
      }),
    ).rejects.toThrow("insert boom");

    expect(mockEscUpdate).not.toHaveBeenCalled();
    expect(dbosSendMock).not.toHaveBeenCalled();
  });

  it("throws when the escalations resolution update fails, before DBOS.send", async () => {
    mockEscEq.mockResolvedValueOnce({ error: { message: "update boom" } });

    await expect(
      handleMissingInfoReplyReceived({
        escalationId: "esc-1",
        answer: "The AC is above the bed",
        workflowId: "wf-abc-123",
      }),
    ).rejects.toThrow("update boom");

    expect(dbosSendMock).not.toHaveBeenCalled();
  });
});
