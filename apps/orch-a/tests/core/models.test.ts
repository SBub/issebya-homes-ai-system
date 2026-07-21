import { describe, expect, it } from "vitest";
import { detectAnomalies, type Report, renderReport } from "../../src/core/models.js";
import type { AvailabilitySnapshot } from "../../src/tools/availability.js";
import type { CampaignStats } from "../../src/tools/campaigns.js";
import type { FinanceSnapshot } from "../../src/tools/finance.js";

function availability(overrides: Partial<AvailabilitySnapshot> = {}): AvailabilitySnapshot {
  return {
    propertyId: "room1",
    propertyName: "Room 1",
    availableNightsNext30d: 20,
    occupancyRateNext30d: 0.33,
    lastUpdated: new Date(),
    ...overrides,
  };
}

function finance(overrides: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  return {
    propertyId: "room1",
    revenueMonthToDate: 1000,
    outstandingPayouts: 100,
    lastUpdated: new Date(),
    ...overrides,
  };
}

function campaignStats(overrides: Partial<CampaignStats> = {}): CampaignStats {
  return {
    kind: "seasonal_nudge",
    issued: 0,
    sent: 0,
    rejected: 0,
    expired: 0,
    redeemed: 0,
    ...overrides,
  };
}

function report(overrides: Partial<Report> = {}): Report {
  return {
    summary: "",
    availability: [],
    finance: [],
    campaigns: [],
    anomalies: [],
    health: [],
    ...overrides,
  };
}

describe("detectAnomalies", () => {
  it("flags nothing when occupancy and revenue are healthy", () => {
    expect(detectAnomalies([availability()], [finance()])).toEqual([]);
  });

  it("flags low occupancy under the threshold", () => {
    const result = detectAnomalies(
      [availability({ propertyName: "Room 2", occupancyRateNext30d: 0.1 })],
      [],
    );
    expect(result).toEqual(["Room 2: low occupancy (10%)"]);
  });

  it("does not flag occupancy right at the threshold", () => {
    expect(detectAnomalies([availability({ occupancyRateNext30d: 0.3 })], [])).toEqual([]);
  });

  it("flags zero revenue", () => {
    const result = detectAnomalies([], [finance({ propertyId: "room2", revenueMonthToDate: 0 })]);
    expect(result).toEqual(["Room 2: zero revenue recorded"]);
  });

  it("never invents a property not present in the input", () => {
    const result = detectAnomalies(
      [availability({ propertyName: "Room 1", occupancyRateNext30d: 0.05 })],
      [finance({ propertyId: "room1", revenueMonthToDate: 0 })],
    );
    expect(result).toEqual(["Room 1: low occupancy (5%)", "Room 1: zero revenue recorded"]);
  });
});

describe("renderReport", () => {
  it("renders a Campaigns line per kind with readable labels", () => {
    const text = renderReport(
      report({
        campaigns: [
          campaignStats({ kind: "seasonal_nudge", issued: 3, sent: 2, rejected: 1 }),
          campaignStats({ kind: "stalled_link_nudge", issued: 1, sent: 0, rejected: 0 }),
        ],
      }),
    );

    expect(text).toContain("<b>Campaigns</b>");
    expect(text).toContain("• Seasonal check-in: 3 issued · 2 sent · 1 rejected");
    expect(text).toContain("• Stalled booking-link follow-up: 1 issued · 0 sent · 0 rejected");
  });

  it("still renders the Campaigns section header at all-zero", () => {
    const text = renderReport(
      report({
        campaigns: [
          campaignStats({ kind: "seasonal_nudge" }),
          campaignStats({ kind: "stalled_link_nudge" }),
        ],
      }),
    );

    expect(text).toContain("• Seasonal check-in: 0 issued · 0 sent · 0 rejected");
    expect(text).toContain("• Stalled booking-link follow-up: 0 issued · 0 sent · 0 rejected");
  });

  it("never emits a PII-shaped field from campaign stats", () => {
    const text = renderReport(
      report({ campaigns: [campaignStats({ kind: "seasonal_nudge", issued: 5 })] }),
    );

    for (const field of ["guest_contact_id", "phone", "code"]) {
      expect(text.includes(field)).toBe(false);
    }
  });
});
