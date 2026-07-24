import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// campaigns/stats.test.ts — this route issues a single terminal
// .from("guest_contacts").select(...).order(...) call.
const orderMock = vi.fn();
const selectMock = vi.fn(() => ({ order: orderMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/guest-contacts/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/guest-contacts", {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

describe("GET /api/guest-contacts", () => {
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

  it("returns guests: [] when the table is empty", async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(json).toEqual({ guests: [] });
  });

  it("returns every row with every real column", async () => {
    const row = {
      id: "contact-1",
      phone: "+351920742845",
      guest_name: "Marion Tremintin",
      guest_name_normalized: "marion tremintin",
      last_room: "room_1",
      last_stay_checkin: "2026-07-10",
      last_stay_checkout: "2026-07-15",
      total_stays: 2,
      platform: "airbnb",
      funnel_stage: "link_sent",
      last_interaction_at: "2026-07-18T09:00:00Z",
      link_sent_at: "2026-07-17T09:00:00Z",
      stage_updated_at: "2026-07-17T09:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-07-18T09:00:00Z",
    };
    orderMock.mockResolvedValueOnce({ data: [row], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json).toEqual({ guests: [row] });
    expect(selectMock).toHaveBeenCalledWith(
      "id, phone, guest_name, guest_name_normalized, last_room, last_stay_checkin, last_stay_checkout, total_stays, platform, funnel_stage, last_interaction_at, link_sent_at, stage_updated_at, created_at, updated_at",
    );
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
