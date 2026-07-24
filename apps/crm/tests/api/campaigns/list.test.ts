import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// guest-contacts/list.test.ts — the top-level .from("campaigns")
// .select("*").order(...) call uses this select->order chain. Per-campaign
// candidate_count queries (this route now calls countUndraftedCandidates,
// which is real, un-mocked code from lib/campaigns.ts) need their own
// richer chain — see makeQueryChain below, same shape as
// tests/lib/campaigns.test.ts's own makeChain helper.
const orderMock = vi.fn();
const selectMock = vi.fn(() => ({ order: orderMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/campaigns/route.js");

/**
 * Minimal fake Supabase query-builder chain, thenable so
 * `await supabase.from(...).select(...)...` resolves to `result` directly —
 * used for the guest_contacts/promo_codes queries countUndraftedCandidates
 * issues per campaign row (getCampaignCandidates/alreadyNudgedGuestIds).
 * Mirrors tests/lib/campaigns.test.ts's own makeChain.
 */
function makeQueryChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt", "gte", "in"]) {
    chain[method] = vi.fn(() => chain);
  }
  // biome-ignore lint/suspicious/noThenProperty: see tests/lib/campaigns.test.ts's own makeChain
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

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

  it("returns every row with every real column plus a candidate_count, ordered by created_at ascending", async () => {
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
    // countUndraftedCandidates -> getCampaignCandidates (guest_contacts),
    // then alreadyNudgedGuestIds (promo_codes) — one extra query pair for
    // this single campaign row. Two candidates, one already nudged, so
    // candidate_count should come back as 1.
    const candidatesChain = makeQueryChain({
      data: [
        { id: "guest-1", phone: "+351900000001" },
        { id: "guest-2", phone: "+351900000002" },
      ],
      error: null,
    });
    const alreadyNudgedChain = makeQueryChain({
      data: [{ guest_contact_id: "guest-2" }],
      error: null,
    });
    fromMock
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce(candidatesChain as never)
      .mockReturnValueOnce(alreadyNudgedChain as never);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json).toEqual({ campaigns: [{ ...row, candidate_count: 1 }] });
    expect(selectMock).toHaveBeenCalledWith("*");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(fromMock).toHaveBeenCalledWith("promo_codes");
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
