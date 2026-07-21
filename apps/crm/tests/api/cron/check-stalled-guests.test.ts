import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route is a thin auth + wiring wrapper around
// @/lib/campaigns.js's runCheckStalledGuests (unit-tested in its own right
// in tests/lib/campaigns.test.ts) — mock both module boundaries here rather
// than re-testing that logic through the route.
const runCheckStalledGuestsMock = vi.fn();
vi.mock("@/lib/campaigns.js", () => ({
  runCheckStalledGuests: runCheckStalledGuestsMock,
}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/cron/check-stalled-guests/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/cron/check-stalled-guests", {
    method: "POST",
    headers: { "X-API-Key": apiKey },
  });
}

describe("POST /api/cron/check-stalled-guests", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    runCheckStalledGuestsMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest("wrong-key"));
    expect(res.status).toBe(401);
    expect(runCheckStalledGuestsMock).not.toHaveBeenCalled();
  });

  it("returns runCheckStalledGuests' summary on success", async () => {
    runCheckStalledGuestsMock.mockResolvedValueOnce({
      seasonal_nudge_drafted: 2,
      stalled_link_nudge_drafted: 1,
      skipped_already_nudged: 3,
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      seasonal_nudge_drafted: 2,
      stalled_link_nudge_drafted: 1,
      skipped_already_nudged: 3,
    });
  });

  it("returns a 500 with the error message when runCheckStalledGuests throws", async () => {
    runCheckStalledGuestsMock.mockRejectedValueOnce(new Error("db unreachable"));

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db unreachable" });
  });
});
