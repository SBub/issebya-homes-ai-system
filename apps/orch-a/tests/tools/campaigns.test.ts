import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCampaignStats } from "../../src/tools/campaigns.js";

const originalEnv = { ...process.env };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe("fetchCampaignStats", () => {
  beforeEach(() => {
    process.env.CRM_API_URL = "http://localhost:3006";
    process.env.CRM_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws when CRM_API_URL is not configured", async () => {
    delete process.env.CRM_API_URL;
    await expect(fetchCampaignStats()).rejects.toThrow(/CRM_API_URL/);
  });

  it("throws when CRM_API_KEY is not configured", async () => {
    delete process.env.CRM_API_KEY;
    await expect(fetchCampaignStats()).rejects.toThrow(/CRM_API_KEY/);
  });

  it("calls CRM's GET /api/campaigns/stats with the X-API-Key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        campaigns: [
          { kind: "seasonal_nudge", issued: 0, sent: 0, rejected: 0, expired: 0, redeemed: 0 },
          { kind: "stalled_link_nudge", issued: 0, sent: 0, rejected: 0, expired: 0, redeemed: 0 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchCampaignStats();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3006/api/campaigns/stats", {
      headers: { "X-API-Key": "test-key" },
    });
  });

  it("zod-parses and returns the campaigns array on success", async () => {
    const campaigns = [
      { kind: "seasonal_nudge", issued: 3, sent: 2, rejected: 1, expired: 0, redeemed: 0 },
      { kind: "stalled_link_nudge", issued: 1, sent: 0, rejected: 0, expired: 1, redeemed: 0 },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ campaigns })));

    const result = await fetchCampaignStats();
    expect(result).toEqual(campaigns);
  });

  it("throws when the fetch response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));

    await expect(fetchCampaignStats()).rejects.toThrow(/campaign stats fetch failed: 500/);
  });

  it("throws when a returned entry doesn't match the schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ campaigns: [{ kind: "not_a_real_kind" }] })),
    );

    await expect(fetchCampaignStats()).rejects.toThrow();
  });
});
