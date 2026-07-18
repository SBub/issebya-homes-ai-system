import { describe, expect, it } from "vitest";
import { detectAnomalies } from "../../src/core/models.js";
import type { AvailabilitySnapshot } from "../../src/tools/availability.js";
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
