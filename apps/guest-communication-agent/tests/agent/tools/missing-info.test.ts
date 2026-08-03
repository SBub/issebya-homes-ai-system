import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks every real external boundary this file's functions touch: Postgres
// (@/lib/supabase, routed by table name — escalations, documents,
// whatsapp_messages), telegram-router (the escalation nudge), the embedding
// call (ai's embed + @ai-sdk/openai's createOpenAI), and
// resumeConversationWithAnswer (@/lib/resume-conversation — its own real
// behavior is covered by tests/lib/resume-conversation.test.ts, not here).
const mockEscSingle = vi.fn();
const mockEscSelect = vi.fn(() => ({ single: mockEscSingle }));
const mockEscInsert = vi.fn(() => ({ select: mockEscSelect }));
const mockEscEq = vi.fn();
const mockEscUpdate = vi.fn(() => ({ eq: mockEscEq }));

const mockDocInsert = vi.fn();

// Return shape varies by table (escalations/documents/whatsapp_messages),
// kept as `any` on purpose rather than fighting a union type across every
// test below that swaps in a different per-table mock.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = vi.fn((table: string): any => {
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

const resumeConversationWithAnswerMock = vi.fn();
vi.mock("@/lib/resume-conversation.js", () => ({
  resumeConversationWithAnswer: resumeConversationWithAnswerMock,
}));

const embedMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, embed: embedMock };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: (model: string) => model }),
}));

const {
  runMissingInfo,
  waitForMissingInfoReply,
  HitlNotImplementedError,
  handleMissingInfoNoReply,
} = await import("@/agent/tools/missing-info.js");

const toolContext = { conversationId: "convo-1", phone: "+351920742845" };

describe("waitForMissingInfoReply (stub)", () => {
  it("always throws HitlNotImplementedError — no real suspend/wait exists yet", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(waitForMissingInfoReply("esc-1")).rejects.toThrow(HitlNotImplementedError);
    await expect(waitForMissingInfoReply("esc-1")).rejects.toThrow(/esc-1/);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("esc-1"));

    consoleWarnSpy.mockRestore();
  });
});

describe("handleMissingInfoNoReply (stub)", () => {
  it("resolves without doing anything real yet — just logs that it's a stub", async () => {
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
    mockEscSingle.mockResolvedValue({ data: { id: "esc-1" }, error: null });
    mockEscEq.mockResolvedValue({ error: null });
    sendEscalationNudgeMock.mockResolvedValue({ ok: true, telegramMessageId: 4242 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("step 1 (real): inserts the escalation and sends the Telegram nudge exactly like the other escalation tools", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

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

  it("steps 2-3 (stub): falls back to the real, already-working owner-notified response since waitForMissingInfoReply always throws, and never reaches the embedding step", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    // Step 3 (embed the reply into the KB) is unreachable today — the
    // stub's expected failure is caught before it, so no embedding/document
    // write and no resumeConversationWithAnswer call ever happen.
    expect(embedMock).not.toHaveBeenCalled();
    expect(mockDocInsert).not.toHaveBeenCalled();
    expect(resumeConversationWithAnswerMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to the real owner-notified response"),
    );
  });

  it("skips the stub wait entirely (and still returns the fallback message) when the escalation insert itself failed", async () => {
    mockEscSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runMissingInfo({ reason: "Guest asked about the AC" }, toolContext);

    expect(result).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
    // No escalation id means nothing to wait on — waitForMissingInfoReply
    // (and its console.warn) is never even called in this branch.
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("HitlNotImplementedError is a distinct, named Error subclass — runMissingInfo's catch only swallows this specific expected stub failure, not genuine bugs", () => {
    const err = new HitlNotImplementedError("esc-x");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HitlNotImplementedError");
    expect(err.message).toContain("esc-x");
  });
});

describe("handleMissingInfoReplyReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    mockDocInsert.mockResolvedValue({ error: null });
    mockEscEq.mockResolvedValue({ error: null });
  });

  it("embeds the answer, inserts into documents, and resolves the escalation, returning sentToGuest:false when there's no triggerMessageId", async () => {
    const { handleMissingInfoReplyReceived } = await import("@/agent/tools/missing-info.js");

    const result = await handleMissingInfoReplyReceived({
      escalationId: "esc-1",
      answer: "The AC is above the bed",
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageId: null,
    });

    expect(result).toEqual({ sentToGuest: false });
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
    expect(resumeConversationWithAnswerMock).not.toHaveBeenCalled();
  });

  it("throws when the documents insert fails, before touching the escalations update", async () => {
    mockDocInsert.mockResolvedValueOnce({ error: { message: "insert boom" } });
    const { handleMissingInfoReplyReceived } = await import("@/agent/tools/missing-info.js");

    await expect(
      handleMissingInfoReplyReceived({
        escalationId: "esc-1",
        answer: "The AC is above the bed",
        conversationId: "convo-1",
        phone: "+351920742845",
        triggerMessageId: null,
      }),
    ).rejects.toThrow("insert boom");

    expect(mockEscUpdate).not.toHaveBeenCalled();
  });

  it("throws when the escalations resolution update fails", async () => {
    mockEscEq.mockResolvedValueOnce({ error: { message: "update boom" } });
    const { handleMissingInfoReplyReceived } = await import("@/agent/tools/missing-info.js");

    await expect(
      handleMissingInfoReplyReceived({
        escalationId: "esc-1",
        answer: "The AC is above the bed",
        conversationId: "convo-1",
        phone: "+351920742845",
        triggerMessageId: null,
      }),
    ).rejects.toThrow("update boom");
  });

  it("calls resumeConversationWithAnswer when a triggerMessageId is supplied, returning sentToGuest:true on success", async () => {
    const mockMsgMaybeSingle = vi.fn().mockResolvedValue({
      data: { content: "Is there a swimming pool?" },
      error: null,
    });
    const mockMsgEq = vi.fn(() => ({ maybeSingle: mockMsgMaybeSingle }));
    const mockMsgSelect = vi.fn(() => ({ eq: mockMsgEq }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "documents") return { insert: mockDocInsert };
      if (table === "escalations") return { insert: mockEscInsert, update: mockEscUpdate };
      if (table === "whatsapp_messages") return { select: mockMsgSelect };
      throw new Error(`unexpected table "${table}"`);
    });
    resumeConversationWithAnswerMock.mockResolvedValueOnce({ ok: true });

    const { handleMissingInfoReplyReceived } = await import("@/agent/tools/missing-info.js");

    const result = await handleMissingInfoReplyReceived({
      escalationId: "esc-1",
      answer: "The AC is above the bed",
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageId: "msg-1",
    });

    expect(result).toEqual({ sentToGuest: true });
    expect(mockMsgSelect).toHaveBeenCalledWith("content");
    expect(mockMsgEq).toHaveBeenCalledWith("id", "msg-1");
    expect(resumeConversationWithAnswerMock).toHaveBeenCalledWith({
      conversationId: "convo-1",
      phone: "+351920742845",
      triggerMessageContent: "Is there a swimming pool?",
    });
  });
});
