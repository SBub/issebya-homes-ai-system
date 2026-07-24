import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// apps/crm's route tests (e.g. campaigns/stats.test.ts, register.test.ts).
// This route issues up to two sequential .from() calls
// (whatsapp_conversations, then whatsapp_messages), each ending in its own
// .order(...) — distinguished here by which table fromMock was called with.
const conversationsOrderMock = vi.fn();
const conversationsInMock = vi.fn(() => ({ order: conversationsOrderMock }));
const conversationsSelectMock = vi.fn(() => ({ in: conversationsInMock }));

const messagesOrderMock = vi.fn();
const messagesInMock = vi.fn(() => ({ order: messagesOrderMock }));
const messagesSelectMock = vi.fn(() => ({ in: messagesInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "whatsapp_conversations") {
    return { select: conversationsSelectMock };
  }
  if (table === "whatsapp_messages") {
    return { select: messagesSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/conversations/route.js");

function makeRequest(phone: string | null, apiKey = "test-key"): NextRequest {
  const url = new URL("http://localhost:3005/api/conversations");
  if (phone !== null) {
    url.searchParams.set("phone", phone);
  }
  return new NextRequest(url, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

describe("GET /api/conversations", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    conversationsOrderMock.mockReset();
    conversationsInMock.mockClear();
    conversationsSelectMock.mockClear();
    messagesOrderMock.mockReset();
    messagesInMock.mockClear();
    messagesSelectMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("+351920742845", "wrong-key"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the phone query parameter is missing", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("queries both the bare and whatsapp:-prefixed phone forms", async () => {
    conversationsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    await GET(makeRequest("+351920742845"));

    expect(conversationsInMock).toHaveBeenCalledWith("phone_number", [
      "+351920742845",
      "whatsapp:+351920742845",
    ]);
  });

  it("returns conversations: [] (200, not 404) when no conversations exist", async () => {
    conversationsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    const res = await GET(makeRequest("+351920742845"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ conversations: [] });
    expect(messagesSelectMock).not.toHaveBeenCalled();
  });

  it("returns one conversation with its messages ordered oldest-first", async () => {
    conversationsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "conv-1", status: "active", started_at: "2026-07-20T10:00:00Z", closed_at: null },
      ],
      error: null,
    });
    messagesOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-1",
          role: "user",
          content: "Hi, is the room available?",
          created_at: "2026-07-20T10:00:05Z",
        },
        {
          id: "msg-2",
          conversation_id: "conv-1",
          role: "assistant",
          content: "Yes it is!",
          created_at: "2026-07-20T10:00:10Z",
        },
      ],
      error: null,
    });

    const res = await GET(makeRequest("+351920742845"));
    const json = await res.json();

    expect(json).toEqual({
      conversations: [
        {
          id: "conv-1",
          status: "active",
          started_at: "2026-07-20T10:00:00Z",
          closed_at: null,
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Hi, is the room available?",
              created_at: "2026-07-20T10:00:05Z",
            },
            {
              id: "msg-2",
              role: "assistant",
              content: "Yes it is!",
              created_at: "2026-07-20T10:00:10Z",
            },
          ],
        },
      ],
    });
    expect(messagesInMock).toHaveBeenCalledWith("conversation_id", ["conv-1"]);
  });

  it("returns multiple conversations, each with only its own messages", async () => {
    conversationsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "conv-2", status: "active", started_at: "2026-07-21T09:00:00Z", closed_at: null },
        {
          id: "conv-1",
          status: "closed",
          started_at: "2026-07-10T09:00:00Z",
          closed_at: "2026-07-10T09:30:00Z",
        },
      ],
      error: null,
    });
    messagesOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "msg-old",
          conversation_id: "conv-1",
          role: "user",
          content: "Old conversation message",
          created_at: "2026-07-10T09:05:00Z",
        },
        {
          id: "msg-new",
          conversation_id: "conv-2",
          role: "user",
          content: "New conversation message",
          created_at: "2026-07-21T09:05:00Z",
        },
      ],
      error: null,
    });

    const res = await GET(makeRequest("+351920742845"));
    const json = await res.json();

    expect(json.conversations).toHaveLength(2);
    expect(json.conversations[0].id).toBe("conv-2");
    expect(json.conversations[0].messages).toEqual([
      {
        id: "msg-new",
        role: "user",
        content: "New conversation message",
        created_at: "2026-07-21T09:05:00Z",
      },
    ]);
    expect(json.conversations[1].id).toBe("conv-1");
    expect(json.conversations[1].messages).toEqual([
      {
        id: "msg-old",
        role: "user",
        content: "Old conversation message",
        created_at: "2026-07-10T09:05:00Z",
      },
    ]);
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    conversationsOrderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest("+351920742845"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
