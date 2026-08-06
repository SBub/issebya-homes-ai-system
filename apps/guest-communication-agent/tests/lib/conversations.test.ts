import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getOrCreateActiveConversation issues up to two sequential
// .from("whatsapp_conversations") calls (lookup, then insert if nothing
// found), each with its own chain shape, stubbed independently.
const maybeSingleMock = vi.fn();
const limitMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const orderMock = vi.fn(() => ({ limit: limitMock }));
const eqMock = vi.fn(() => ({ order: orderMock }));
const selectInMock = vi.fn(() => ({ eq: eqMock }));
const selectMock = vi.fn(() => ({ in: selectInMock }));

const insertSelectSingleMock = vi.fn();
const insertSelectMock = vi.fn(() => ({ single: insertSelectSingleMock }));
const insertMock = vi.fn(() => ({ select: insertSelectMock }));

const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { getOrCreateActiveConversation, recordMessage } = await import("@/lib/conversations.js");

describe("getOrCreateActiveConversation", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    limitMock.mockClear();
    orderMock.mockClear();
    eqMock.mockClear();
    selectInMock.mockClear();
    selectMock.mockClear();
    insertSelectSingleMock.mockReset();
    insertSelectMock.mockClear();
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds an existing active conversation stored prefixed when queried with the bare form", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "conv-1" }, error: null });

    const result = await getOrCreateActiveConversation("+351920742845");

    expect(selectInMock).toHaveBeenCalledWith("phone_number", [
      "+351920742845",
      "whatsapp:+351920742845",
    ]);
    expect(eqMock).toHaveBeenCalledWith("status", "active");
    expect(result).toEqual({ conversationId: "conv-1", isNew: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("finds an existing active conversation when queried with the already-prefixed form (regression case)", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "conv-1" }, error: null });

    const result = await getOrCreateActiveConversation("whatsapp:+351920742845");

    // Deduped — the already-prefixed input isn't passed twice into `.in(...)`.
    expect(selectInMock).toHaveBeenCalledWith("phone_number", ["whatsapp:+351920742845"]);
    expect(result).toEqual({ conversationId: "conv-1", isNew: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("picks the most-recently-started active conversation when more than one row matches across phone forms", async () => {
    // Ordered newest-first + limit(1) is exactly how this degrades
    // gracefully instead of erroring on >1 row — the mock only needs to
    // return the one row the query itself would have narrowed down to.
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "conv-newest" }, error: null });

    const result = await getOrCreateActiveConversation("+351920742845");

    expect(orderMock).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(result).toEqual({ conversationId: "conv-newest", isNew: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("creates a new conversation stored under the prefixed form when passed the bare form and none exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "conv-new" }, error: null });

    const result = await getOrCreateActiveConversation("+351920742845");

    expect(insertMock).toHaveBeenCalledWith({ phone_number: "whatsapp:+351920742845" });
    expect(result).toEqual({ conversationId: "conv-new", isNew: true });
  });

  it("creates a new conversation stored under the prefixed form when passed the already-prefixed form and none exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "conv-new" }, error: null });

    const result = await getOrCreateActiveConversation("whatsapp:+351920742845");

    expect(insertMock).toHaveBeenCalledWith({ phone_number: "whatsapp:+351920742845" });
    expect(result).toEqual({ conversationId: "conv-new", isNew: true });
  });

  it("throws when the insert fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(getOrCreateActiveConversation("+351920742845")).rejects.toThrow(
      "Failed to create whatsapp_conversation for +351920742845: boom",
    );
  });
});

describe("recordMessage", () => {
  beforeEach(() => {
    insertSelectSingleMock.mockReset();
    insertSelectMock.mockClear();
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the new whatsapp_messages row's id", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "msg-1" }, error: null });

    const result = await recordMessage("convo-1", "user", "Hi, is room 1 free?");

    expect(fromMock).toHaveBeenCalledWith("whatsapp_messages");
    expect(insertMock).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      role: "user",
      content: "Hi, is room 1 free?",
    });
    expect(insertSelectMock).toHaveBeenCalledWith("id");
    expect(result).toBe("msg-1");
  });

  it("includes trace_id in the insert when supplied", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "msg-2" }, error: null });

    const result = await recordMessage("convo-1", "assistant", "Yes, room 1 is free!", "run-1");

    expect(insertMock).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      role: "assistant",
      content: "Yes, room 1 is free!",
      trace_id: "run-1",
    });
    expect(result).toBe("msg-2");
  });

  it("throws when the insert fails", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(recordMessage("convo-1", "user", "Hi")).rejects.toThrow(
      "Failed to record user message for conversation convo-1: boom",
    );
  });
});
