"use client";

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useMemo, useState } from "react";
import {
  findFirstMonthWithAvailability,
  isDateBlocked,
  isPastDate,
  isValidDateRange,
} from "@/lib/date-utils";
import type { DateRange } from "@/lib/shared/types/booking";

type BookingCalendarProps = {
  blockedDates: DateRange[];
  selectedCheckIn: Date | null;
  selectedCheckOut: Date | null;
  onDateSelect: (date: Date) => void;
};

// Generate calendar days for a given month
function generateMonthDays(month: Date): Date[] {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);

  const days: Date[] = [];
  let day = calendarStart;
  while (day <= calendarEnd) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

export function BookingCalendar({
  blockedDates,
  selectedCheckIn,
  selectedCheckOut,
  onDateSelect,
}: BookingCalendarProps) {
  // Find the first month with available dates to show initially
  const initialMonth = useMemo(() => findFirstMonthWithAvailability(blockedDates), [blockedDates]);

  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const nextMonthDate = addMonths(currentMonth, 1);

  // Generate days for both months
  const leftMonthDays = generateMonthDays(currentMonth);
  const rightMonthDays = generateMonthDays(nextMonthDate);

  // Navigate to previous month
  const prevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  // Navigate to next month
  const nextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  // Get CSS classes for a date
  const getDateClasses = (date: Date, monthContext: Date): string => {
    const classes = ["calendar-date"];
    const monthStart = startOfMonth(monthContext);

    // Not in current month context
    if (!isSameMonth(date, monthStart)) {
      classes.push("calendar-date-outside-month");
      return classes.join(" ");
    }

    // Past date
    if (isPastDate(date)) {
      classes.push("calendar-date-blocked");
      return classes.join(" ");
    }

    // Blocked date — unless it's a valid check-out on the first blocked day after check-in
    const isBlocked = isDateBlocked(date, blockedDates);
    const isValidCheckOut =
      isBlocked &&
      selectedCheckIn !== null &&
      isAfter(date, selectedCheckIn) &&
      isValidDateRange(selectedCheckIn, date, blockedDates);

    if (isBlocked && !isValidCheckOut) {
      // Checkout boundary: first day of a blocked range immediately after available days.
      // Show diagonal stripe instead of full strikethrough to hint guest can check out here.
      const prevDay = addDays(date, -1);
      const isCheckoutBoundary = !isPastDate(prevDay) && !isDateBlocked(prevDay, blockedDates);

      classes.push(
        isCheckoutBoundary ? "calendar-date-checkout-boundary" : "calendar-date-blocked",
      );
      return classes.join(" ");
    }

    // Selected range
    if (selectedCheckIn && selectedCheckOut) {
      if (isSameDay(date, selectedCheckIn)) {
        classes.push("calendar-date-selected");
      } else if (isSameDay(date, selectedCheckOut)) {
        classes.push("calendar-date-selected");
      } else if (isAfter(date, selectedCheckIn) && isBefore(date, selectedCheckOut)) {
        classes.push("calendar-date-selected");
      }
    } else if (selectedCheckIn && isSameDay(date, selectedCheckIn)) {
      classes.push("calendar-date-selected");
    }

    // Available date
    classes.push("calendar-date-available");

    return classes.join(" ");
  };

  // Check if date is clickable
  const isDateClickable = (date: Date, monthContext: Date): boolean => {
    if (!isSameMonth(date, startOfMonth(monthContext))) return false;
    if (isPastDate(date)) return false;
    if (isDateBlocked(date, blockedDates)) {
      // Allow clicking a blocked date as check-out if all preceding nights are free
      return (
        selectedCheckIn !== null &&
        isAfter(date, selectedCheckIn) &&
        isValidDateRange(selectedCheckIn, date, blockedDates)
      );
    }
    return true;
  };

  // Handle date click
  const handleDateClick = (date: Date, monthContext: Date) => {
    if (isDateClickable(date, monthContext)) {
      onDateSelect(date);
    }
  };

  // Keyboard navigation handler
  const handleKeyDown = (e: React.KeyboardEvent, date: Date, monthContext: Date) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleDateClick(date, monthContext);
    }
  };

  // Render a single month
  const renderMonth = (month: Date, days: Date[]) => (
    <div className="calendar-month">
      {/* Month title */}
      <h4 className="calendar-month-title font-hand">{format(month, "MMMM yyyy")}</h4>

      {/* Day names */}
      <div className="calendar-day-names">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((dayName, idx) => (
          <div key={`${dayName}-${idx}`} className="calendar-day-name">
            {dayName}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="calendar-grid">
        {days.map((date, index) => {
          const isClickable = isDateClickable(date, month);
          return (
            <button
              key={index}
              type="button"
              onClick={() => handleDateClick(date, month)}
              onKeyDown={(e) => handleKeyDown(e, date, month)}
              className={getDateClasses(date, month)}
              disabled={!isClickable}
              aria-label={format(date, "MMMM d, yyyy")}
              aria-pressed={
                selectedCheckIn && isSameDay(date, selectedCheckIn)
                  ? true
                  : selectedCheckOut && isSameDay(date, selectedCheckOut)
                    ? true
                    : undefined
              }
              tabIndex={isClickable ? 0 : -1}
            >
              {format(date, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="booking-calendar booking-calendar-two-months">
      {/* Navigation header */}
      <div className="calendar-header">
        <button
          type="button"
          onClick={prevMonth}
          className="calendar-nav-button"
          aria-label="Previous month"
        >
          ←
        </button>
        <div className="calendar-header-spacer" />
        <button
          type="button"
          onClick={nextMonth}
          className="calendar-nav-button"
          aria-label="Next month"
        >
          →
        </button>
      </div>

      {/* Two months side by side */}
      <div className="calendar-months-container">
        {renderMonth(currentMonth, leftMonthDays)}
        {renderMonth(nextMonthDate, rightMonthDays)}
      </div>

      {/* Legend */}
      <div className="calendar-legend">
        {[
          { className: "calendar-date-available", label: "Available" },
          { className: "calendar-date-selected", label: "Selected" },
          {
            className: "calendar-date-checkout-boundary",
            label: "Check-out only",
          },
          { className: "calendar-date-blocked", label: "Unavailable" },
        ].map(({ className, label }) => (
          <div key={label} className="calendar-legend-item">
            <span className={`calendar-legend-swatch ${className}`} aria-hidden="true" />
            <span className="calendar-legend-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
