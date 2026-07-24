import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route is a thin auth + wiring wrapper around @/lib/campaigns.js's
// getCampaignById/draftForCampaign (unit-tested in their own right in
// tests/lib/campaigns.test.ts) — mock the module boundary here rather than
// re-testing that logic through the route, same approach as
// tests/api/cron/check-stalled-guests.test.ts.
const getCampaignByIdMock = vi.fn();
const draftForCampaignMock = vi.fn();
vi.mock("@/lib/campaigns.js", () => ({
  getCampaignById: getCampaignByIdMock,
  draftForCampaign: draftForCampaignMock,
}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/campaigns/[id]/run/route.js");

function makeRequest(id: string, apiKey = "test-key"): NextRequest {
  return new NextRequest(`http://localhost:3006/api/campaigns/${id}/run`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ONE_OFF_CAMPAIGN = {
  id: "campaign-one-off",
  name: "Summer 2026 win-back",
  kind: "win_back",
  target_funnel_stage: null,
  min_idle_days: null,
  target_stay_before: "2026-01-01",
  min_total_stays: null,
  discount_percent: 15,
  offer_description: "15% off your next stay",
  message_template: "Hi {{guest_name}}, come back for {{offer_description}} — use {{promo_code}}!",
  is_recurring: false,
  enabled: true,
};

describe("POST /api/campaigns/[id]/run", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    getCampaignByIdMock.mockReset();
    draftForCampaignMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest("campaign-one-off", "wrong-key"),
      makeParams("campaign-one-off"),
    );

    expect(res.status).toBe(401);
    expect(getCampaignByIdMock).not.toHaveBeenCalled();
    expect(draftForCampaignMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no campaigns row matches the id", async () => {
    getCampaignByIdMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest("missing-id"), makeParams("missing-id"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(draftForCampaignMock).not.toHaveBeenCalled();
  });

  it("runs draftForCampaign for the matched campaign and returns its counts", async () => {
    getCampaignByIdMock.mockResolvedValueOnce(ONE_OFF_CAMPAIGN);
    draftForCampaignMock.mockResolvedValueOnce({ drafted: 4, skipped: 1 });

    const res = await POST(makeRequest("campaign-one-off"), makeParams("campaign-one-off"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      campaign_id: "campaign-one-off",
      kind: "win_back",
      drafted: 4,
      skipped: 1,
    });
    expect(getCampaignByIdMock).toHaveBeenCalledWith(expect.anything(), "campaign-one-off");
    expect(draftForCampaignMock).toHaveBeenCalledWith(expect.anything(), ONE_OFF_CAMPAIGN);
  });

  it("returns a 500 with the error message when draftForCampaign throws", async () => {
    getCampaignByIdMock.mockResolvedValueOnce(ONE_OFF_CAMPAIGN);
    draftForCampaignMock.mockRejectedValueOnce(new Error("db unreachable"));

    const res = await POST(makeRequest("campaign-one-off"), makeParams("campaign-one-off"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db unreachable" });
  });

  it("returns a 500 with the error message when getCampaignById throws", async () => {
    getCampaignByIdMock.mockRejectedValueOnce(new Error("db unreachable"));

    const res = await POST(makeRequest("campaign-one-off"), makeParams("campaign-one-off"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db unreachable" });
  });
});
