import { computeCurrentDate } from "./current-date";

// Shared date guard for every tool that takes a checkIn/checkOut pair, so
// availability.ts and booking.ts can't disagree about the same range.

export type StayRangeProblem = "invalid_date" | "past_date" | "invalid_range";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  // LANDMINE: a NaN check alone is not enough — V8 silently rolls an
  // impossible day over ("2026-02-31" parses as 2026-03-03) instead of
  // rejecting it, so the parsed date has to round-trip back to the input.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Returns the first problem with a requested stay, or null when it is
 * usable. `checkIn === today` is valid — same-day bookings must keep
 * working. `today` defaults to current-date.ts's computeCurrentDate, the
 * single source of "now" in this app (including its UTC caveat).
 */
export function validateStayRange(
  checkIn: string,
  checkOut: string,
  today: string = computeCurrentDate().date,
): StayRangeProblem | null {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) {
    return "invalid_date";
  }
  // Lexicographic comparison is exact for YYYY-MM-DD, which keeps month and
  // year rollovers free of any timezone arithmetic.
  if (checkIn < today) {
    return "past_date";
  }
  if (checkOut <= checkIn) {
    return "invalid_range";
  }
  return null;
}
