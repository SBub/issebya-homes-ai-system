import { describe, expect, it } from "vitest";
import { checkAvailabilityFreshness, checkHeartbeat } from "../../src/health/checks.js";
import type { AvailabilitySnapshot } from "../../src/tools/availability.js";

describe("checkHeartbeat", () => {
  it("is missing when no prior run", () => {
    expect(checkHeartbeat(null, 60).status).toBe("missing");
  });

  it("is ok when recent", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const lastRun = new Date(now.getTime() - 5 * 60_000);
    expect(checkHeartbeat(lastRun, 60, now).status).toBe("ok");
  });

  it("is stale when overdue", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const lastRun = new Date(now.getTime() - 2 * 3_600_000);
    expect(checkHeartbeat(lastRun, 60, now).status).toBe("stale");
  });
});

describe("checkAvailabilityFreshness", () => {
  it("is missing when empty", () => {
    expect(checkAvailabilityFreshness([], 24).status).toBe("missing");
  });

  it("is stale when old", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const snapshot: AvailabilitySnapshot = {
      propertyId: "p1",
      propertyName: "Test Property",
      availableNightsNext30d: 10,
      occupancyRateNext30d: 0.5,
      lastUpdated: new Date(now.getTime() - 48 * 3_600_000),
    };
    expect(checkAvailabilityFreshness([snapshot], 24, now).status).toBe("stale");
  });
});
