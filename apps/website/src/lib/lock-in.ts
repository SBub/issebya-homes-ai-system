/**
 * Lock-in weeks: one room, check-in Monday, check-out the following Monday.
 *
 * The page (which weeks to offer, which are booked) and the Server Action
 * (which ranges to accept) both read their rules from here, so the two cannot
 * disagree. Weeks travel as calendar-day strings, never `Date`s (see
 * `date-utils.ts`).
 */

import { addDays, isBefore, isMonday, max, nextMonday, startOfDay } from "date-fns";
import {
  fromCalendarDay,
  isValidDateRange,
  mergeDateRanges,
  toCalendarDay,
} from "@/lib/date-utils";
import type { DateRange } from "@/lib/shared/types/booking";
import { LOCK_IN_PRICING } from "pricing";

/** The first lock-in check-in day (a Monday). */
export const LOCK_IN_FIRST_CHECK_IN = "2026-11-02";

/** How many weeks the page offers. */
const LOCK_IN_WEEKS_SHOWN = 12;

export type LockInWeek = { checkIn: string; checkOut: string };

export type ClassifiedLockInWeek = LockInWeek & { available: boolean };

/**
 * The `count` weeks on offer as of `today`: starting at the first Monday on or
 * after both today and `LOCK_IN_FIRST_CHECK_IN`. A week that has already
 * started is never offered; a Monday "today" is.
 */
export function getLockInWeeks(today: Date, count = LOCK_IN_WEEKS_SHOWN): LockInWeek[] {
  const start = max([startOfDay(today), fromCalendarDay(LOCK_IN_FIRST_CHECK_IN)]);
  const firstMonday = isMonday(start) ? start : nextMonday(start);

  return Array.from({ length: count }, (_, i) => {
    const checkIn = addDays(firstMonday, 7 * i);
    return {
      checkIn: toCalendarDay(checkIn),
      checkOut: toCalendarDay(addDays(checkIn, LOCK_IN_PRICING.nights)),
    };
  });
}

/**
 * Marks each week available only when all its nights are free on the merged
 * calendar. Same predicate and merge as the nightly calendar and the
 * pre-checkout re-check.
 */
export function classifyLockInWeeks(
  weeks: LockInWeek[],
  bookings: DateRange[],
): ClassifiedLockInWeek[] {
  const blocked = mergeDateRanges(bookings);
  return weeks.map((week) => ({
    ...week,
    available: isValidDateRange(
      fromCalendarDay(week.checkIn),
      fromCalendarDay(week.checkOut),
      blocked,
    ),
  }));
}

const INVALID_WEEK_MESSAGE = "Please pick one of the lock-in weeks shown (Monday to Monday).";
const PAST_WEEK_MESSAGE = "This lock-in week has already started. Please pick a later week.";

/**
 * Server-side check that a browser-supplied range is a lock-in week: a Monday
 * on or after `LOCK_IN_FIRST_CHECK_IN`, exactly one week long, not in the past.
 * Availability is checked separately.
 */
export function validateLockInWeek(
  checkIn: string,
  checkOut: string,
  today: Date,
): { ok: true } | { ok: false; error: string } {
  const checkInDate = fromCalendarDay(checkIn);
  const checkOutDate = fromCalendarDay(checkOut);

  if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) {
    return { ok: false, error: INVALID_WEEK_MESSAGE };
  }

  if (
    !isMonday(checkInDate) ||
    isBefore(checkInDate, fromCalendarDay(LOCK_IN_FIRST_CHECK_IN)) ||
    toCalendarDay(addDays(checkInDate, LOCK_IN_PRICING.nights)) !== toCalendarDay(checkOutDate)
  ) {
    return { ok: false, error: INVALID_WEEK_MESSAGE };
  }

  if (isBefore(checkInDate, startOfDay(today))) {
    return { ok: false, error: PAST_WEEK_MESSAGE };
  }

  return { ok: true };
}
