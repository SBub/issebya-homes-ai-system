import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConversationByIdMock = vi.fn();
const getConversationMessagesMock = vi.fn();
vi.mock("@/lib/admin-conversations.js", () => ({
  getConversationById: getConversationByIdMock,
  getConversationMessages: getConversationMessagesMock,
}));

const listPendingOwnerDecisionsForConversationMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  listPendingOwnerDecisionsForConversation: listPendingOwnerDecisionsForConversationMock,
}));

const { GET } = await import("@/app/api/admin/conversations/[id]/messages/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/admin/conversations/convo-1/messages", {
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/admin/conversations/[id]/messages", () => {
  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    getConversationByIdMock.mockReset();
    getConversationMessagesMock.mockReset();
    listPendingOwnerDecisionsForConversationMock.mockReset();
    getConversationByIdMock.mockResolvedValue({
      id: "convo-1",
      phone: "+351920742845",
      status: "active",
      startedAt: "2026-08-01T00:00:00.000Z",
      closedAt: null,
    });
    getConversationMessagesMock.mockResolvedValue([]);
    listPendingOwnerDecisionsForConversationMock.mockResolvedValue([]);
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("wrong"), makeParams("convo-1"));
    expect(res.status).toBe(401);
    expect(getConversationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation doesn't exist", async () => {
    getConversationByIdMock.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), makeParams("convo-missing"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Conversation not found" });
    expect(getConversationMessagesMock).not.toHaveBeenCalled();
  });

  it("returns the conversation, its messages, and pendingDecisions with a computed stuck flag", async () => {
    getConversationMessagesMock.mockResolvedValueOnce([
      {
        id: "msg-1",
        role: "user",
        content: "Hi",
        createdAt: "2026-08-01T00:00:00.000Z",
        deliveryStatus: null,
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "Hello!",
        createdAt: "2026-08-01T00:01:00.000Z",
        deliveryStatus: "sent",
      },
    ]);
    const oldRelayedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    listPendingOwnerDecisionsForConversationMock.mockResolvedValueOnce([
      {
        id: "decision-1",
        correlationId: "corr-1",
        toolName: "missing_info",
        conversationId: "convo-1",
        phone: "+351920742845",
        reason: "Guest asked about the sauna",
        context: null,
        sentAt: "2026-08-01T00:00:00.000Z",
        relayedAt: oldRelayedAt,
        resolvedAt: null,
        resolution: null,
      },
    ]);

    const res = await GET(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.conversation).toEqual({
      id: "convo-1",
      phone: "+351920742845",
      status: "active",
      startedAt: "2026-08-01T00:00:00.000Z",
      closedAt: null,
    });
    expect(json.messages).toHaveLength(2);
    expect(json.pendingDecisions).toEqual([
      expect.objectContaining({ id: "decision-1", toolName: "missing_info", stuck: true }),
    ]);
  });

  it("reports stuck: false for a pending decision relayed less than 5 minutes ago", async () => {
    const recentRelayedAt = new Date(Date.now() - 60 * 1000).toISOString();
    listPendingOwnerDecisionsForConversationMock.mockResolvedValueOnce([
      {
        id: "decision-2",
        correlationId: "corr-2",
        toolName: "send_booking_link",
        conversationId: "convo-1",
        phone: "+351920742845",
        reason: "Ana wants to book room1",
        context: null,
        sentAt: "2026-08-01T00:00:00.000Z",
        relayedAt: recentRelayedAt,
        resolvedAt: null,
        resolution: null,
      },
    ]);

    const res = await GET(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(json.pendingDecisions).toEqual([expect.objectContaining({ stuck: false })]);
  });

  it("returns a 500 with the error message when a query fails", async () => {
    getConversationMessagesMock.mockRejectedValueOnce(new Error("db boom"));

    const res = await GET(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db boom" });
  });
});
