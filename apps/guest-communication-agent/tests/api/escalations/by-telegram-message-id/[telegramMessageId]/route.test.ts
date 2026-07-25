import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// tests/api/messages/[messageId]/feedback/route.test.ts — this route issues
// a single .from("escalations").select(...).eq(...).maybeSingle() call.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import(
  "@/app/api/escalations/by-telegram-message-id/[telegramMessageId]/route.js"
);

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/escalations/by-telegram-message-id/42", {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(telegramMessageId: string) {
  return { params: Promise.resolve({ telegramMessageId }) };
}

describe("GET /api/escalations/by-telegram-message-id/[telegramMessageId]", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    maybeSingleMock.mockReset();
    eqMock.mockClear();
    selectMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("wrong-key"), makeParams("42"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 without querying Supabase when the id isn't numeric", async () => {
    const res = await GET(makeRequest(), makeParams("not-a-number"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Escalation not found" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no escalation matches the telegram message id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await GET(makeRequest(), makeParams("42"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Escalation not found" });
    expect(eqMock).toHaveBeenCalledWith("telegram_message_id", 42);
  });

  it("returns the matching escalation", async () => {
    const row = {
      id: "esc-1",
      phone_number: "whatsapp:+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: null,
      answer: null,
    };
    maybeSingleMock.mockResolvedValueOnce({ data: row, error: null });

    const res = await GET(makeRequest(), makeParams("42"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(row);
    expect(selectMock).toHaveBeenCalledWith(
      "id, phone_number, reason, reason_category, resolved_at, answer",
    );
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest(), makeParams("42"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
