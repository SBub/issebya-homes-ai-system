"use client";

import { format } from "date-fns";
import { LOCK_IN_PRICING } from "pricing";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { fromCalendarDay } from "@/lib/date-utils";
import type { ClassifiedLockInWeek, LockInWeek } from "@/lib/lock-in";
import { formatPrice } from "@/lib/price-utils";

type LockInWeekGridProps = {
  weeks: ClassifiedLockInWeek[];
  selectedCheckIn: string | null;
  onSelect: (week: LockInWeek) => void;
};

export function formatLockInRange(week: LockInWeek): string {
  return `${format(fromCalendarDay(week.checkIn), "d MMM")} – ${format(
    fromCalendarDay(week.checkOut),
    "d MMM",
  )}`;
}

/**
 * The lock-in weeks as cards. A booked week is a plain `<div>`, never a
 * button, so it cannot be picked or styled as available by accident.
 */
export function LockInWeekGrid({ weeks, selectedCheckIn, onSelect }: LockInWeekGridProps) {
  const anyAvailable = weeks.some((week) => week.available);

  return (
    <>
      <div className="lock-in-weeks">
        {weeks.map((week) => {
          const range = formatLockInRange(week);

          if (!week.available) {
            return (
              <div
                key={week.checkIn}
                className="lock-in-week lock-in-week-booked"
                aria-disabled="true"
              >
                <span className="lock-in-week-range">{range}</span>
                <span className="lock-in-week-meta">Booked</span>
              </div>
            );
          }

          const selected = week.checkIn === selectedCheckIn;
          return (
            <button
              key={week.checkIn}
              type="button"
              className={`lock-in-week lock-in-week-available ${selected ? "lock-in-week-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect({ checkIn: week.checkIn, checkOut: week.checkOut })}
            >
              <span className="lock-in-week-range">{range}</span>
              <span className="lock-in-week-meta">
                {LOCK_IN_PRICING.nights} nights · {formatPrice(LOCK_IN_PRICING.weekPrice)}
              </span>
            </button>
          );
        })}
      </div>

      {!anyAvailable && (
        <p className="text-secondary text-sm mt-4">
          All the lock-in weeks shown are booked. Message us on <WhatsAppLink /> for later weeks.
        </p>
      )}
    </>
  );
}
