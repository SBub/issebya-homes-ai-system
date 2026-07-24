import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// guest-contacts/list.test.ts — this route issues a single terminal
// .from("campaigns").select("*").order(...) call.
const orderMock = vi.fn();
const selectMock = vi.fn(() => ({ order: orderMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/campaigns/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/campaigns", {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

describe("GET /api/campaigns", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
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

  it("returns campaigns: [] when the table is empty", async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(fromMock).toHaveBeenCalledWith("campaigns");
    expect(json).toEqual({ campaigns: [] });
  });

  it("returns every row with every real column, ordered by created_at ascending", async () => {
    const row = {
      id: "campaign-seasonal",
      name: "Seasonal check-in (automated)",
      kind: "seasonal_nudge",
      target_funnel_stage: "new",
      min_idle_days: 3,
      target_stay_before: null,
      min_total_stays: null,
      discount_percent: null,
      offer_description: "",
      message_template: "Hi! Just checking in — no rush at all.",
      is_recurring: true,
      enabled: true,
      created_at: "2026-07-01T00:00:00Z",
    };
    orderMock.mockResolvedValueOnce({ data: [row], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json).toEqual({ campaigns: [row] });
    expect(selectMock).toHaveBeenCalledWith("*");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
