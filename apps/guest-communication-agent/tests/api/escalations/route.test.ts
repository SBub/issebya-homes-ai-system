import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// apps/crm's own list-route tests (e.g. guest-contacts/list.test.ts) — this
// route issues a single terminal .from("escalations").select(...).order(...)
// call.
const orderMock = vi.fn();
const selectMock = vi.fn(() => ({ order: orderMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/escalations/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/escalations", {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

describe("GET /api/escalations", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    orderMock.mockReset();
    selectMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("wrong-key"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns escalations: [] when the table is empty", async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(fromMock).toHaveBeenCalledWith("escalations");
    expect(json).toEqual({ escalations: [] });
  });

  it("returns every row, newest first, including resolved_at/answer", async () => {
    const row = {
      id: "esc-1",
      conversation_id: "convo-1",
      phone_number: "whatsapp:+351920742845",
      reason: "Guest asked about AC, couldn't find it in the knowledge base",
      reason_category: "missing_info",
      created_at: "2026-07-25T09:00:00Z",
      resolved_at: "2026-07-25T10:00:00Z",
      answer: "The AC is above the bed",
    };
    orderMock.mockResolvedValueOnce({ data: [row], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json).toEqual({ escalations: [row] });
    expect(selectMock).toHaveBeenCalledWith(
      "id, conversation_id, phone_number, reason, reason_category, created_at, resolved_at, answer",
    );
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
