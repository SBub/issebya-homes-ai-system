import { addDays, differenceInDays, isAfter, isBefore, isSameDay, startOfDay } from "date-fns";
import type { DateRange, ICalEvent } from "@/lib/shared/types/booking";

/**
 * Check if a date falls within any blocked range
 * Note: Check-out dates are NOT blocked (room is available that night)
 */
export function isDateBlocked(date: Date, blockedRanges: DateRange[]): boolean {
  const targetDate = startOfDay(date);

  return blockedRanges.some((range) => {
    const rangeStart = startOfDay(range.start);
    const rangeEnd = startOfDay(range.end);

    // Check if date is within the range (inclusive of start, exclusive of end)
    // This means check-out dates ARE available for new bookings
    return (
      (isAfter(targetDate, rangeStart) || isSameDay(targetDate, rangeStart)) &&
      isBefore(targetDate, rangeEnd)
    );
  });
}

/**
 * Convert iCal events to blocked date ranges
 * Check-out dates (dtend) are excluded from blocked ranges
 */
export function getBlockedDates(events: ICalEvent[]): DateRange[] {
  return events.map((event) => ({
    start: startOfDay(event.dtstart),
    end: startOfDay(event.dtend),
  }));
}

/**
 * Merge overlapping or adjacent date ranges for optimization
 */
export function mergeDateRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];

  // Sort ranges by start date
  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: DateRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastMerged = merged[merged.length - 1];

    // Check if current range overlaps or is adjacent to last merged range
    if (isBefore(current.start, lastMerged.end) || isSameDay(current.start, lastMerged.end)) {
      // Extend the last merged range if current ends later
      if (isAfter(current.end, lastMerged.end)) {
        lastMerged.end = current.end;
      }
    } else {
      // No overlap, add as new range
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Find first N consecutive available nights starting from today
 * Returns null if no such range exists within the next 90 days
 */
export function findFirstAvailableNights(
  blockedRanges: DateRange[],
  nights: number,
): DateRange | null {
  const today = startOfDay(new Date());
  const maxDate = addDays(today, 90); // Search within next 3 months

  let currentDate = today;

  while (isBefore(currentDate, maxDate)) {
    const potentialCheckOut = addDays(currentDate, nights);

    // Check if all nights in this range are available
    let isRangeAvailable = true;
    for (let i = 0; i < nights; i++) {
      const nightDate = addDays(currentDate, i);
      if (isDateBlocked(nightDate, blockedRanges)) {
        isRangeAvailable = false;
        // Skip to the day after the blocking range ends
        const blockingRange = blockedRanges.find((range) => {
          const rangeStart = startOfDay(range.start);
          const rangeEnd = startOfDay(range.end);
          return (
            (isAfter(nightDate, rangeStart) || isSameDay(nightDate, rangeStart)) &&
            isBefore(nightDate, rangeEnd)
          );
        });
        if (blockingRange) {
          currentDate = startOfDay(blockingRange.end);
        } else {
          currentDate = addDays(currentDate, 1);
        }
        break;
      }
    }

    if (isRangeAvailable) {
      return {
        start: currentDate,
        end: potentialCheckOut,
      };
    }

    // If we didn't skip forward in the loop, move to next day
    if (isRangeAvailable || isSameDay(currentDate, today)) {
      currentDate = addDays(currentDate, 1);
    }
  }

  return null; // No available dates found
}

/**
 * Validate that a selected date range doesn't overlap with blocked dates
 */
export function isValidDateRange(
  checkIn: Date,
  checkOut: Date,
  blockedRanges: DateRange[],
): boolean {
  // Check that check-in is before check-out
  if (!isBefore(checkIn, checkOut)) {
    return false;
  }

  // Check that check-in is not in the past
  const today = startOfDay(new Date());
  if (isBefore(checkIn, today)) {
    return false;
  }

  // Calculate number of nights
  const nights = differenceInDays(checkOut, checkIn);

  // Check each night is available
  for (let i = 0; i < nights; i++) {
    const nightDate = addDays(checkIn, i);
    if (isDateBlocked(nightDate, blockedRanges)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a specific date is in the past
 */
export function isPastDate(date: Date): boolean {
  const today = startOfDay(new Date());
  return isBefore(date, today);
}

/**
 * Find the first month that has available dates
 * Returns the start of the month that contains at least one available date
 */
export function findFirstMonthWithAvailability(
  blockedRanges: DateRange[],
  maxMonthsToSearch: number = 12,
): Date {
  const today = startOfDay(new Date());
  let currentMonth = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));

  for (let i = 0; i < maxMonthsToSearch; i++) {
    const monthStart = currentMonth;
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    // Check each day in this month for availability
    let day = isBefore(monthStart, today) ? today : monthStart;

    while (day <= monthEnd) {
      if (!isDateBlocked(day, blockedRanges)) {
        // Found an available date in this month
        return monthStart;
      }
      day = addDays(day, 1);
    }

    // Move to next month
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  }

  // If no availability found, return current month as fallback
  return startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
}
