import { addDays, startOfDay } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DateRange, ICalEvent } from "@/lib/shared/types/booking";
import {
  findFirstAvailableNights,
  findFirstMonthWithAvailability,
  fromCalendarDay,
  getBlockedDates,
  isDateBlocked,
  isPastDate,
  isValidDateRange,
  mergeDateRanges,
  toCalendarDay,
} from "../date-utils";

/** Helper to create a DateRange from date strings */
function range(start: string, end: string): DateRange {
  return { start: new Date(start), end: new Date(end) };
}

describe("isDateBlocked", () => {
  const blocked: DateRange[] = [range("2025-06-05", "2025-06-10")];

  it("returns true for a date inside the blocked range", () => {
    expect(isDateBlocked(new Date("2025-06-07"), blocked)).toBe(true);
  });

  it("returns true for the start date (inclusive)", () => {
    expect(isDateBlocked(new Date("2025-06-05"), blocked)).toBe(true);
  });

  it("returns false for the end date (exclusive — check-out day is available)", () => {
    expect(isDateBlocked(new Date("2025-06-10"), blocked)).toBe(false);
  });

  it("returns false for a date before the range", () => {
    expect(isDateBlocked(new Date("2025-06-04"), blocked)).toBe(false);
  });

  it("returns false for a date after the range", () => {
    expect(isDateBlocked(new Date("2025-06-11"), blocked)).toBe(false);
  });

  it("returns false when there are no blocked ranges", () => {
    expect(isDateBlocked(new Date("2025-06-07"), [])).toBe(false);
  });

  it("checks across multiple blocked ranges", () => {
    const ranges = [range("2025-06-01", "2025-06-03"), range("2025-06-10", "2025-06-12")];
    expect(isDateBlocked(new Date("2025-06-02"), ranges)).toBe(true);
    expect(isDateBlocked(new Date("2025-06-11"), ranges)).toBe(true);
    expect(isDateBlocked(new Date("2025-06-05"), ranges)).toBe(false);
  });
});

describe("getBlockedDates", () => {
  it("converts iCal events to date ranges", () => {
    const events: ICalEvent[] = [
      {
        dtstart: new Date("2025-06-05T14:00:00"),
        dtend: new Date("2025-06-08T11:00:00"),
        summary: "Booking",
      },
    ];
    const result = getBlockedDates(events);

    expect(result).toHaveLength(1);
    expect(result[0].start).toEqual(startOfDay(new Date("2025-06-05")));
    expect(result[0].end).toEqual(startOfDay(new Date("2025-06-08")));
  });

  it("returns empty array for no events", () => {
    expect(getBlockedDates([])).toEqual([]);
  });
});

describe("mergeDateRanges", () => {
  it("returns empty array for empty input", () => {
    expect(mergeDateRanges([])).toEqual([]);
  });

  it("returns single range unchanged", () => {
    const ranges = [range("2025-06-01", "2025-06-05")];
    const result = mergeDateRanges(ranges);
    expect(result).toHaveLength(1);
  });

  it("merges overlapping ranges", () => {
    const ranges = [range("2025-06-01", "2025-06-05"), range("2025-06-03", "2025-06-08")];
    const result = mergeDateRanges(ranges);

    expect(result).toHaveLength(1);
    expect(result[0].start).toEqual(new Date("2025-06-01"));
    expect(result[0].end).toEqual(new Date("2025-06-08"));
  });

  it("merges adjacent ranges (end date equals start date)", () => {
    const ranges = [range("2025-06-01", "2025-06-05"), range("2025-06-05", "2025-06-10")];
    const result = mergeDateRanges(ranges);

    expect(result).toHaveLength(1);
    expect(result[0].start).toEqual(new Date("2025-06-01"));
    expect(result[0].end).toEqual(new Date("2025-06-10"));
  });

  it("does not merge non-overlapping ranges", () => {
    const ranges = [range("2025-06-01", "2025-06-03"), range("2025-06-05", "2025-06-08")];
    const result = mergeDateRanges(ranges);
    expect(result).toHaveLength(2);
  });

  it("handles unsorted input", () => {
    const ranges = [
      range("2025-06-10", "2025-06-15"),
      range("2025-06-01", "2025-06-05"),
      range("2025-06-04", "2025-06-12"),
    ];
    const result = mergeDateRanges(ranges);

    expect(result).toHaveLength(1);
    expect(result[0].start).toEqual(new Date("2025-06-01"));
    expect(result[0].end).toEqual(new Date("2025-06-15"));
  });

  it("handles range fully contained within another", () => {
    const ranges = [range("2025-06-01", "2025-06-10"), range("2025-06-03", "2025-06-07")];
    const result = mergeDateRanges(ranges);

    expect(result).toHaveLength(1);
    expect(result[0].end).toEqual(new Date("2025-06-10"));
  });
});

describe("findFirstAvailableNights", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today when no dates are blocked", () => {
    const result = findFirstAvailableNights([], 2);
    expect(result).not.toBeNull();
    expect(result!.start).toEqual(startOfDay(new Date("2025-06-01")));
    expect(result!.end).toEqual(startOfDay(new Date("2025-06-03")));
  });

  it("skips blocked dates and finds next available window", () => {
    const blocked = [range("2025-06-01", "2025-06-05")];
    const result = findFirstAvailableNights(blocked, 2);

    expect(result).not.toBeNull();
    // First available is June 5 (end date is exclusive, so check-out day is free)
    expect(result!.start).toEqual(startOfDay(new Date("2025-06-05")));
    expect(result!.end).toEqual(startOfDay(new Date("2025-06-07")));
  });

  it("returns null when no availability in the 90-day window", () => {
    // Block the entire 90-day window
    const blocked = [range("2025-06-01", "2025-09-01")];
    const result = findFirstAvailableNights(blocked, 2);
    expect(result).toBeNull();
  });

  it("finds a gap between two blocked ranges", () => {
    const blocked = [range("2025-06-01", "2025-06-10"), range("2025-06-13", "2025-06-20")];
    const result = findFirstAvailableNights(blocked, 3);

    expect(result).not.toBeNull();
    expect(result!.start).toEqual(startOfDay(new Date("2025-06-10")));
    expect(result!.end).toEqual(startOfDay(new Date("2025-06-13")));
  });
});

describe("isValidDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for a valid future range with no blocked dates", () => {
    expect(isValidDateRange(new Date("2025-06-10"), new Date("2025-06-13"), [])).toBe(true);
  });

  it("returns false when check-out is before check-in", () => {
    expect(isValidDateRange(new Date("2025-06-13"), new Date("2025-06-10"), [])).toBe(false);
  });

  it("returns false when check-in equals check-out", () => {
    expect(isValidDateRange(new Date("2025-06-10"), new Date("2025-06-10"), [])).toBe(false);
  });

  it("returns false when check-in is in the past", () => {
    expect(isValidDateRange(new Date("2025-05-20"), new Date("2025-05-25"), [])).toBe(false);
  });

  it("returns false when a night in the range is blocked", () => {
    const blocked = [range("2025-06-11", "2025-06-12")];
    expect(isValidDateRange(new Date("2025-06-10"), new Date("2025-06-13"), blocked)).toBe(false);
  });

  it("returns true when blocked range is only on the check-out date (exclusive)", () => {
    const blocked = [range("2025-06-13", "2025-06-15")];
    expect(isValidDateRange(new Date("2025-06-10"), new Date("2025-06-13"), blocked)).toBe(true);
  });
});

describe("isPastDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for a date in the past", () => {
    expect(isPastDate(new Date("2025-06-10"))).toBe(true);
  });

  it("returns false for today", () => {
    expect(isPastDate(new Date("2025-06-15"))).toBe(false);
  });

  it("returns false for a future date", () => {
    expect(isPastDate(new Date("2025-06-20"))).toBe(false);
  });
});

describe("findFirstMonthWithAvailability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns current month when dates are available", () => {
    const result = findFirstMonthWithAvailability([]);
    expect(result).toEqual(startOfDay(new Date("2025-06-01")));
  });

  it("returns next month when current month is fully blocked", () => {
    // Block remaining days of June (from today June 15 to July 1)
    const blocked = [range("2025-06-01", "2025-07-01")];
    const result = findFirstMonthWithAvailability(blocked);
    expect(result).toEqual(startOfDay(new Date("2025-07-01")));
  });

  it("falls back to current month when no availability is found", () => {
    // Block an absurdly long range
    const blocked = [range("2025-06-01", "2027-01-01")];
    const result = findFirstMonthWithAvailability(blocked);
    expect(result).toEqual(startOfDay(new Date("2025-06-01")));
  });
});

// A calendar day is a label, not a moment, so these conversions are only ever
// wrong in a timezone the test process does not happen to be in. Pinning TZ
// explicitly is what makes the bug visible: Node re-reads process.env.TZ on
// the next Date operation, so mutating it really does move the process's
// local calendar.
function withTimezone<T>(timeZone: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// Europe/Lisbon and Europe/Berlin are ahead of UTC in September, Pacific/Auckland
// far ahead, America/New_York behind. Only the ahead-of-UTC ones ever shifted.
const TIMEZONES = ["UTC", "Europe/Lisbon", "Europe/Berlin", "Pacific/Auckland", "America/New_York"];

describe("toCalendarDay", () => {
  it.each(TIMEZONES)("labels a picked date with the local calendar day in %s", (timeZone) => {
    withTimezone(timeZone, () => {
      // What a browser builds when the guest clicks the cell for 21 Sep 2026.
      const picked = new Date(2026, 8, 21);
      expect(toCalendarDay(picked)).toBe("2026-09-21");
    });
  });

  // The exact worked example from the bug report: a guest in Portugal on
  // summer time (UTC+1) clicks 21 Sep, and their browser's instant is already
  // the 20th in UTC. Reading that instant in UTC, which is what Vercel does,
  // is what recorded the wrong day.
  it("keeps the guest's day even when their local midnight is the previous UTC day", () => {
    withTimezone("Europe/Lisbon", () => {
      const picked = new Date(2026, 8, 21);
      expect(picked.toISOString()).toBe("2026-09-20T23:00:00.000Z");
      expect(picked.toISOString().slice(0, 10)).toBe("2026-09-20");
      expect(toCalendarDay(picked)).toBe("2026-09-21");
    });
  });

  it("labels a date picked late in the day as that same day", () => {
    withTimezone("Europe/Berlin", () => {
      expect(toCalendarDay(new Date(2026, 8, 21, 23, 59, 59))).toBe("2026-09-21");
    });
  });
});

describe("fromCalendarDay", () => {
  it.each(TIMEZONES)("parses a calendar day to local midnight in %s", (timeZone) => {
    withTimezone(timeZone, () => {
      const parsed = fromCalendarDay("2026-09-21");
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(8);
      expect(parsed.getDate()).toBe(21);
      expect(parsed.getHours()).toBe(0);
    });
  });

  it.each(TIMEZONES)("round-trips a calendar day unchanged in %s", (timeZone) => {
    withTimezone(timeZone, () => {
      for (const day of ["2026-01-01", "2026-06-15", "2026-09-21", "2026-12-31", "2024-02-29"]) {
        expect(toCalendarDay(fromCalendarDay(day))).toBe(day);
      }
    });
  });

  it("returns an Invalid Date for input that is not a calendar day", () => {
    for (const bad of ["", "21-09-2026", "2026-13-01", "2026-02-31", "not-a-date"]) {
      expect(Number.isNaN(fromCalendarDay(bad).getTime())).toBe(true);
    }
  });

  // The reason local midnight is the right anchor: isDateBlocked and friends
  // normalise with startOfDay, which is local, and ical.js hands us all-day
  // event boundaries as local midnight too. A UTC-midnight parse disagrees
  // with both everywhere except UTC.
  it.each(TIMEZONES)("agrees with the blocked-range predicate in %s", (timeZone) => {
    withTimezone(timeZone, () => {
      const blocked = [
        { start: fromCalendarDay("2026-09-21"), end: fromCalendarDay("2026-09-24") },
      ];
      expect(isDateBlocked(fromCalendarDay("2026-09-20"), blocked)).toBe(false);
      expect(isDateBlocked(fromCalendarDay("2026-09-21"), blocked)).toBe(true);
      expect(isDateBlocked(fromCalendarDay("2026-09-23"), blocked)).toBe(true);
      // Check-out day is available again.
      expect(isDateBlocked(fromCalendarDay("2026-09-24"), blocked)).toBe(false);
    });
  });
});
