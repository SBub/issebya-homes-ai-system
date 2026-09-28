import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getOrCreateActiveConversation issues up to two sequential
// .from("whatsapp_conversations") calls (lookup, then insert if nothing
// found), each with its own chain shape, stubbed independently.
const maybeSingleMock = vi.fn();
const limitMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const orderMock = vi.fn(() => ({ limit: limitMock }));
const lookupEqStatusMock = vi.fn(() => ({ order: orderMock }));
const lookupEqPhoneMock = vi.fn(() => ({ eq: lookupEqStatusMock }));
const selectMock = vi.fn(() => ({ eq: lookupEqPhoneMock }));

const insertSelectSingleMock = vi.fn();
const insertSelectMock = vi.fn(() => ({ single: insertSelectSingleMock }));
const insertMock = vi.fn(() => ({ select: insertSelectMock }));

// updateMessageDeliveryStatus's own chain: .update(...).eq("id", messageId).
const updateEqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock, update: updateMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { getOrCreateActiveConversation, recordMessage, updateMessageDeliveryStatus } =
  await import("@/lib/conversations.js");

describe("getOrCreateActiveConversation", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    limitMock.mockClear();
    orderMock.mockClear();
    lookupEqStatusMock.mockClear();
    lookupEqPhoneMock.mockClear();
    selectMock.mockClear();
    insertSelectSingleMock.mockReset();
    insertSelectMock.mockClear();
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds an existing active conversation for the bare phone", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "conv-1" }, error: null });

    const result = await getOrCreateActiveConversation("+351920742845");

    expect(lookupEqPhoneMock).toHaveBeenCalledWith("phone_number", "+351920742845");
    expect(lookupEqStatusMock).toHaveBeenCalledWith("status", "active");
    expect(result).toEqual({ conversationId: "conv-1", isNew: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("picks the most-recently-started active conversation when more than one row matches", async () => {
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

  it("creates a new conversation stored bare when none exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "conv-new" }, error: null });

    const result = await getOrCreateActiveConversation("+351920742845");

    expect(insertMock).toHaveBeenCalledWith({ phone_number: "+351920742845" });
    expect(result).toEqual({ conversationId: "conv-new", isNew: true });
  });

  it("throws when the insert fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(getOrCreateActiveConversation("+351920742845")).rejects.toThrow(
      "Failed to create whatsapp_conversation for +351920742845: boom",
    );
  });

  it("throws when the initial active-conversation lookup fails, instead of silently creating a duplicate", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(getOrCreateActiveConversation("+351920742845")).rejects.toThrow(
      "Failed to look up active whatsapp_conversation for +351920742845: boom",
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("recordMessage", () => {
  const VALID_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
  const ZERO_TRACE_ID = "0".repeat(32);

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

    const result = await recordMessage(
      "convo-1",
      "assistant",
      "Yes, room 1 is free!",
      VALID_TRACE_ID,
    );

    expect(insertMock).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      role: "assistant",
      content: "Yes, room 1 is free!",
      trace_id: VALID_TRACE_ID,
    });
    expect(result).toBe("msg-2");
  });

  it("includes turn_messages in the insert when supplied", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "msg-3" }, error: null });
    const turnMessages = {
      schema_version: 1 as const,
      messages: [{ role: "assistant" as const, content: "Room 1 is free." }],
    };

    await recordMessage("convo-1", "assistant", "Room 1 is free.", VALID_TRACE_ID, {
      turnMessages,
    });

    expect(insertMock).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      role: "assistant",
      content: "Room 1 is free.",
      trace_id: VALID_TRACE_ID,
      turn_messages: turnMessages,
    });
  });

  it("returns the existing assistant row's id when the trace already has one (Inngest retry)", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const existingSingleMock = vi.fn().mockResolvedValueOnce({
      data: { id: "msg-existing" },
      error: null,
    });
    const existingEqRoleMock = vi.fn(() => ({ single: existingSingleMock }));
    const existingEqTraceMock = vi.fn(() => ({ eq: existingEqRoleMock }));
    selectMock.mockImplementationOnce(
      () => ({ eq: existingEqTraceMock }) as unknown as ReturnType<typeof selectMock>,
    );

    const result = await recordMessage("convo-1", "assistant", "Yes!", VALID_TRACE_ID);

    expect(existingEqTraceMock).toHaveBeenCalledWith("trace_id", VALID_TRACE_ID);
    expect(existingEqRoleMock).toHaveBeenCalledWith("role", "assistant");
    expect(result).toBe("msg-existing");
  });

  it("still throws on a unique violation for a row without a trace id", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });

    await expect(recordMessage("convo-1", "assistant", "Yes!")).rejects.toThrow(
      "Failed to record assistant message for conversation convo-1: duplicate key value",
    );
  });

  it("stores an invalid (all-zero) trace id as null and returns the new row id even when another zero-trace assistant row exists", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    selectMock.mockClear();
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "msg-new" }, error: null });

    const result = await recordMessage("convo-1", "assistant", "Second reply", ZERO_TRACE_ID);

    expect(insertMock).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      role: "assistant",
      content: "Second reply",
    });
    expect(result).toBe("msg-new");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("throws on a unique violation with an invalid trace id instead of returning another row's id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    selectMock.mockClear();
    insertSelectSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const existingSingleMock = vi.fn().mockResolvedValueOnce({
      data: { id: "msg-existing" },
      error: null,
    });
    const existingEqRoleMock = vi.fn(() => ({ single: existingSingleMock }));
    const existingEqTraceMock = vi.fn(() => ({ eq: existingEqRoleMock }));
    selectMock.mockImplementationOnce(
      () => ({ eq: existingEqTraceMock }) as unknown as ReturnType<typeof selectMock>,
    );

    await expect(
      recordMessage("convo-1", "assistant", "Second reply", ZERO_TRACE_ID),
    ).rejects.toThrow(
      "Failed to record assistant message for conversation convo-1: duplicate key value",
    );
    expect(selectMock).not.toHaveBeenCalled();
    selectMock.mockReset();
    selectMock.mockImplementation(() => ({ eq: lookupEqPhoneMock }));
  });

  it("throws when the insert fails", async () => {
    insertSelectSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(recordMessage("convo-1", "user", "Hi")).rejects.toThrow(
      "Failed to record user message for conversation convo-1: boom",
    );
  });
});

describe("updateMessageDeliveryStatus", () => {
  beforeEach(() => {
    updateEqMock.mockReset();
    updateMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates delivery_status on the given whatsapp_messages row id", async () => {
    updateEqMock.mockResolvedValueOnce({ error: null });

    await updateMessageDeliveryStatus("msg-1", "sent");

    expect(fromMock).toHaveBeenCalledWith("whatsapp_messages");
    expect(updateMock).toHaveBeenCalledWith({ delivery_status: "sent" });
    expect(updateEqMock).toHaveBeenCalledWith("id", "msg-1");
  });

  it("throws when the update fails", async () => {
    updateEqMock.mockResolvedValueOnce({ error: { message: "boom" } });

    await expect(updateMessageDeliveryStatus("msg-1", "failed")).rejects.toThrow(
      "Failed to update delivery_status for whatsapp_messages row msg-1: boom",
    );
  });
});
