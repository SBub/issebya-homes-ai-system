import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// This route is a thin trigger over listConversationsWithStuckSummary — its
// own real query-building/aggregation logic has its own unit coverage
// elsewhere; this file only tests the HTTP layer (auth, limit parsing,
// status mapping).
const listConversationsWithStuckSummaryMock = vi.fn();
vi.mock("@/lib/admin-conversations.js", () => ({
  listConversationsWithStuckSummary: listConversationsWithStuckSummaryMock,
}));

const { GET } = await import("@/app/api/admin/conversations/route.js");

function makeRequest(url: string, apiKey = "test-key"): NextRequest {
  return new NextRequest(url, { headers: { "X-API-Key": apiKey } });
}

describe("GET /api/admin/conversations", () => {
  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    listConversationsWithStuckSummaryMock.mockReset();
    listConversationsWithStuckSummaryMock.mockResolvedValue([]);
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("http://localhost:3005/api/admin/conversations", "wrong"));
    expect(res.status).toBe(401);
    expect(listConversationsWithStuckSummaryMock).not.toHaveBeenCalled();
  });

  it("defaults to a limit of 50", async () => {
    await GET(makeRequest("http://localhost:3005/api/admin/conversations"));
    expect(listConversationsWithStuckSummaryMock).toHaveBeenCalledWith(50);
  });

  it("honors a valid ?limit= query param", async () => {
    await GET(makeRequest("http://localhost:3005/api/admin/conversations?limit=10"));
    expect(listConversationsWithStuckSummaryMock).toHaveBeenCalledWith(10);
  });

  it("caps an oversized ?limit= at 200", async () => {
    await GET(makeRequest("http://localhost:3005/api/admin/conversations?limit=99999"));
    expect(listConversationsWithStuckSummaryMock).toHaveBeenCalledWith(200);
  });

  it("falls back to the default limit for an invalid ?limit= value", async () => {
    await GET(makeRequest("http://localhost:3005/api/admin/conversations?limit=not-a-number"));
    expect(listConversationsWithStuckSummaryMock).toHaveBeenCalledWith(50);
  });

  it("returns the conversations list", async () => {
    const conversations = [{ id: "convo-1", stuck: { any: true } }];
    listConversationsWithStuckSummaryMock.mockResolvedValueOnce(conversations);

    const res = await GET(makeRequest("http://localhost:3005/api/admin/conversations"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ conversations });
  });

  it("returns a 500 with the error message when the query fails", async () => {
    listConversationsWithStuckSummaryMock.mockRejectedValueOnce(new Error("db boom"));

    const res = await GET(makeRequest("http://localhost:3005/api/admin/conversations"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db boom" });
  });
});
