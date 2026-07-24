import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" approach as
// promo-codes/get.test.ts. This route issues a single terminal
// .from("promo_codes").select(...) call (no .eq/.maybeSingle chained), so
// selectMock itself resolves the { data, error } shape.
const selectMock = vi.fn();
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/campaigns/stats/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/campaigns/stats", {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

const KNOWN_PII_FIELDS = ["guest_contact_id", "phone", "guest_phone", "name", "code"];

describe("GET /api/campaigns/stats", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    selectMock.mockReset();
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

  it("returns both known kinds at all-zero when no campaigns/promo_codes exist yet", async () => {
    selectMock.mockResolvedValueOnce({ data: [], error: null });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(fromMock).toHaveBeenCalledWith("promo_codes");
    expect(json).toEqual({
      campaigns: [
        { kind: "seasonal_nudge", issued: 0, sent: 0, rejected: 0, expired: 0, redeemed: 0 },
        { kind: "stalled_link_nudge", issued: 0, sent: 0, rejected: 0, expired: 0, redeemed: 0 },
      ],
    });
  });

  it("aggregates a mix of statuses across both kinds correctly", async () => {
    selectMock.mockResolvedValueOnce({
      data: [
        { status: "issued", campaigns: { kind: "seasonal_nudge" } },
        { status: "issued", campaigns: { kind: "seasonal_nudge" } },
        { status: "sent", campaigns: { kind: "seasonal_nudge" } },
        { status: "rejected", campaigns: { kind: "seasonal_nudge" } },
        { status: "sent", campaigns: { kind: "stalled_link_nudge" } },
        { status: "expired", campaigns: { kind: "stalled_link_nudge" } },
        { status: "expired", campaigns: { kind: "stalled_link_nudge" } },
        // Rows under kinds outside this digest's own fixed allowlist (kind
        // is unrestricted text now, not a DB check constraint — see
        // route.ts's DigestCampaignKind comment) and orphaned rows are
        // silently excluded.
        { status: "issued", campaigns: { kind: "manual" } },
        { status: "issued", campaigns: null },
      ],
      error: null,
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json).toEqual({
      campaigns: [
        { kind: "seasonal_nudge", issued: 2, sent: 1, rejected: 1, expired: 0, redeemed: 0 },
        { kind: "stalled_link_nudge", issued: 0, sent: 1, rejected: 0, expired: 2, redeemed: 0 },
      ],
    });
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    selectMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });

  it("never includes a PII field anywhere in the response shape", async () => {
    selectMock.mockResolvedValueOnce({
      data: [
        { status: "issued", campaigns: { kind: "seasonal_nudge" } },
        { status: "sent", campaigns: { kind: "stalled_link_nudge" } },
      ],
      error: null,
    });

    const res = await GET(makeRequest());
    const json = await res.json();
    const serialized = JSON.stringify(json);

    for (const field of KNOWN_PII_FIELDS) {
      expect(serialized.includes(field)).toBe(false);
    }
    for (const entry of json.campaigns) {
      expect(Object.keys(entry).sort()).toEqual(
        ["expired", "issued", "kind", "redeemed", "rejected", "sent"].sort(),
      );
    }
  });
});
