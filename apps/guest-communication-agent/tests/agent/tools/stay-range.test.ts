import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateStayRange } from "@/agent/tools/stay-range.js";

// The guard is pure, so every case below passes `today` explicitly — no fake
// timers needed except for the default-argument test at the bottom, which is
// the one thing that genuinely reads the clock.
describe("validateStayRange", () => {
  const TODAY = "2026-09-21";

  it("accepts a future range", () => {
    expect(validateStayRange("2026-10-11", "2026-10-13", TODAY)).toBeNull();
  });

  it("accepts a check-in of today, so same-day bookings keep working", () => {
    expect(validateStayRange(TODAY, "2026-09-23", TODAY)).toBeNull();
  });

  it("rejects a check-in one day before today", () => {
    expect(validateStayRange("2026-09-20", "2026-09-23", TODAY)).toBe("past_date");
  });

  it("rejects the 2026-09-21 incident's range, where the model resolved the year to 2025", () => {
    expect(validateStayRange("2025-10-11", "2025-10-13", TODAY)).toBe("past_date");
  });

  it("rejects a check-out equal to the check-in — a zero-night stay", () => {
    expect(validateStayRange("2026-10-11", "2026-10-11", TODAY)).toBe("invalid_range");
  });

  it("rejects a check-out before the check-in", () => {
    expect(validateStayRange("2026-10-13", "2026-10-11", TODAY)).toBe("invalid_range");
  });

  it("compares across a month boundary without any date arithmetic", () => {
    expect(validateStayRange("2026-10-01", "2026-10-03", "2026-09-30")).toBeNull();
    expect(validateStayRange("2026-09-29", "2026-10-03", "2026-09-30")).toBe("past_date");
  });

  it("compares across a year boundary the same way", () => {
    expect(validateStayRange("2027-01-01", "2027-01-03", "2026-12-31")).toBeNull();
    expect(validateStayRange("2026-12-30", "2027-01-03", "2026-12-31")).toBe("past_date");
  });

  it.each(["20260901", "2026-9-1", "tomorrow", "", "2026-02-31", "2026-13-01"])(
    "rejects %s as invalid_date before any range comparison",
    (value) => {
      expect(validateStayRange(value, "2026-10-13", TODAY)).toBe("invalid_date");
      expect(validateStayRange("2026-10-11", value, TODAY)).toBe("invalid_date");
    },
  );

  describe("default `today`", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Just after midnight UTC, the edge current-date.test.ts pins too —
      // computeCurrentDate is UTC-only, so "today" is already 2026-09-21.
      vi.setSystemTime(new Date("2026-09-21T00:15:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("tracks the real clock through computeCurrentDate", () => {
      expect(validateStayRange("2026-09-21", "2026-09-23")).toBeNull();
      expect(validateStayRange("2026-09-20", "2026-09-22")).toBe("past_date");
    });
  });
});
