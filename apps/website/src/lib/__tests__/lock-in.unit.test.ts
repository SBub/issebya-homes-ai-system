import { addDays, isMonday } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";
import { classifyLockInWeeks, getLockInWeeks, validateLockInWeek } from "../lock-in";

// `isValidDateRange` reads the real clock, so "today" is pinned for every
// test and every date is built with `fromCalendarDay` (local midnight).
const TODAY = "2026-10-13";

function range(start: string, end: string) {
  return { start: fromCalendarDay(start), end: fromCalendarDay(end) };
}

describe("getLockInWeeks", () => {
  it("starts on 2 Nov 2026 when today is earlier, with 12 consecutive Monday-to-Monday weeks", () => {
    const weeks = getLockInWeeks(fromCalendarDay(TODAY));

    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toEqual({ checkIn: "2026-11-02", checkOut: "2026-11-09" });
    weeks.forEach((week, i) => {
      const checkIn = fromCalendarDay(week.checkIn);
      expect(isMonday(checkIn)).toBe(true);
      expect(week.checkOut).toBe(toCalendarDay(addDays(checkIn, 7)));
      if (i > 0) expect(week.checkIn).toBe(weeks[i - 1].checkOut);
    });
  });

  it("skips a week that has already started", () => {
    const weeks = getLockInWeeks(fromCalendarDay("2026-11-18"));
    expect(weeks[0].checkIn).toBe("2026-11-23");
  });

  it("keeps the current week when today is its Monday", () => {
    const weeks = getLockInWeeks(fromCalendarDay("2026-11-16"));
    expect(weeks[0].checkIn).toBe("2026-11-16");
  });

  it("starts on the next day when today is the Sunday before a Monday", () => {
    const weeks = getLockInWeeks(fromCalendarDay("2026-11-15"));
    expect(weeks[0].checkIn).toBe("2026-11-16");
  });
});

describe("classifyLockInWeeks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fromCalendarDay(TODAY));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const weeks = [
    { checkIn: "2026-11-02", checkOut: "2026-11-09" },
    { checkIn: "2026-11-09", checkOut: "2026-11-16" },
  ];

  it("marks only the week containing a single blocked night as unavailable", () => {
    const result = classifyLockInWeeks(weeks, [range("2026-11-05", "2026-11-06")]);
    expect(result.map((w) => w.available)).toEqual([false, true]);
  });

  it("does not block the next week when a booking checks out on its Monday", () => {
    const result = classifyLockInWeeks(weeks, [range("2026-11-07", "2026-11-09")]);
    expect(result.map((w) => w.available)).toEqual([false, true]);
  });

  it("does not block the earlier week when a booking checks in on its check-out Monday", () => {
    const result = classifyLockInWeeks(weeks, [range("2026-11-09", "2026-11-11")]);
    expect(result.map((w) => w.available)).toEqual([true, false]);
  });

  it("keeps the weeks' calendar days unchanged", () => {
    const result = classifyLockInWeeks(weeks, []);
    expect(result).toEqual(weeks.map((w) => ({ ...w, available: true })));
  });
});

describe("validateLockInWeek", () => {
  const today = fromCalendarDay(TODAY);

  it("accepts the first lock-in week", () => {
    expect(validateLockInWeek("2026-11-02", "2026-11-09", today)).toEqual({ ok: true });
  });

  it.each([
    ["a Sunday check-in", "2026-11-01", "2026-11-08"],
    ["6 nights", "2026-11-02", "2026-11-08"],
    ["8 nights", "2026-11-02", "2026-11-10"],
    ["a week before the first lock-in", "2026-10-26", "2026-11-02"],
    ["unparseable days", "not-a-day", "also-not"],
  ])("rejects %s", (_label, checkIn, checkOut) => {
    const result = validateLockInWeek(checkIn, checkOut, today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Monday to Monday/);
  });

  it("rejects a week that has already started", () => {
    const result = validateLockInWeek("2026-11-16", "2026-11-23", fromCalendarDay("2026-11-18"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already started/);
  });
});
