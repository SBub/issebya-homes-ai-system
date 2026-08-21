import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// listConversationsWithStuckSummary's three query groups, each stubbed
// independently: whatsapp_conversations' own select/order/limit chain, the
// admin_conversation_message_summary RPC, and listStuckPendingOwnerDecisions
// (mocked at the module boundary — its own reduction has its own test file).
const conversationsLimitMock = vi.fn();
const conversationsOrderMock = vi.fn(() => ({ limit: conversationsLimitMock }));
const conversationsSelectMock = vi.fn(() => ({ order: conversationsOrderMock }));
const fromMock = vi.fn(() => ({ select: conversationsSelectMock }));
const rpcMock = vi.fn();

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

const listStuckPendingOwnerDecisionsMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  listStuckPendingOwnerDecisions: listStuckPendingOwnerDecisionsMock,
}));

const { listConversationsWithStuckSummary } = await import("@/lib/admin-conversations.js");

const CONVERSATION_ROW = {
  id: "convo-1",
  phone_number: "+351920742845",
  status: "active",
  started_at: "2026-08-01T00:00:00.000Z",
  closed_at: null,
};

describe("listConversationsWithStuckSummary", () => {
  beforeEach(() => {
    conversationsLimitMock.mockReset();
    conversationsOrderMock.mockClear();
    conversationsSelectMock.mockClear();
    fromMock.mockClear();
    rpcMock.mockReset();
    listStuckPendingOwnerDecisionsMock.mockReset();
    listStuckPendingOwnerDecisionsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the RPC with every listed conversation's id, not a full message fetch", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: [CONVERSATION_ROW], error: null });
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          conversation_id: "convo-1",
          last_message_id: "msg-1",
          last_message_role: "assistant",
          last_message_content: "Yes, room 1 is free!",
          last_message_created_at: "2026-08-01T00:05:00.000Z",
          last_message_delivery_status: "sent",
          has_failed_delivery: false,
        },
      ],
      error: null,
    });

    const result = await listConversationsWithStuckSummary(50);

    expect(rpcMock).toHaveBeenCalledWith("admin_conversation_message_summary", {
      conversation_ids: ["convo-1"],
    });
    expect(fromMock).toHaveBeenCalledTimes(1); // only whatsapp_conversations, no whatsapp_messages fetch
    expect(result).toEqual([
      {
        id: "convo-1",
        phone: "+351920742845",
        status: "active",
        startedAt: "2026-08-01T00:00:00.000Z",
        closedAt: null,
        lastMessage: {
          id: "msg-1",
          role: "assistant",
          content: "Yes, room 1 is free!",
          createdAt: "2026-08-01T00:05:00.000Z",
          deliveryStatus: "sent",
        },
        stuck: {
          any: false,
          failedDelivery: false,
          orphanedInbound: false,
          pendingDecision: false,
        },
      },
    ]);
  });

  it("treats a conversation with no messages (null last_message_id) as having no last message", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: [CONVERSATION_ROW], error: null });
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          conversation_id: "convo-1",
          last_message_id: null,
          last_message_role: null,
          last_message_content: null,
          last_message_created_at: null,
          last_message_delivery_status: null,
          has_failed_delivery: false,
        },
      ],
      error: null,
    });

    const result = await listConversationsWithStuckSummary(50);

    expect(result[0].lastMessage).toBeNull();
    expect(result[0].stuck.any).toBe(false);
  });

  it("flags failedDelivery from has_failed_delivery even when the last message itself succeeded", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: [CONVERSATION_ROW], error: null });
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          conversation_id: "convo-1",
          last_message_id: "msg-2",
          last_message_role: "assistant",
          last_message_content: "All set!",
          last_message_created_at: "2026-08-01T00:10:00.000Z",
          last_message_delivery_status: "sent",
          has_failed_delivery: true,
        },
      ],
      error: null,
    });

    const result = await listConversationsWithStuckSummary(50);

    expect(result[0].stuck.failedDelivery).toBe(true);
    expect(result[0].stuck.any).toBe(true);
  });

  it("flags pendingDecision from listStuckPendingOwnerDecisions", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: [CONVERSATION_ROW], error: null });
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          conversation_id: "convo-1",
          last_message_id: null,
          last_message_role: null,
          last_message_content: null,
          last_message_created_at: null,
          last_message_delivery_status: null,
          has_failed_delivery: false,
        },
      ],
      error: null,
    });
    listStuckPendingOwnerDecisionsMock.mockResolvedValueOnce([{ conversationId: "convo-1" }]);

    const result = await listConversationsWithStuckSummary(50);

    expect(result[0].stuck.pendingDecision).toBe(true);
    expect(result[0].stuck.any).toBe(true);
  });

  it("returns an empty array without calling the RPC when there are no conversations", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: [], error: null });

    const result = await listConversationsWithStuckSummary(50);

    expect(result).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws when the RPC call fails", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: [CONVERSATION_ROW], error: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(listConversationsWithStuckSummary(50)).rejects.toThrow(
      "Failed to compute admin_conversation_message_summary: boom",
    );
  });

  it("throws when the whatsapp_conversations query fails", async () => {
    conversationsLimitMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(listConversationsWithStuckSummary(50)).rejects.toThrow(
      "Failed to list whatsapp_conversations: boom",
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
