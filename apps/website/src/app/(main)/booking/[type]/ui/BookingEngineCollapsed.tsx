"use client";

import { format } from "date-fns";
import { BookingPricing } from "./BookingPricing";

type BookingEngineCollapsedProps = {
  checkInDate: Date | null;
  checkOutDate: Date | null;
  onExpand: () => void;
};

export function BookingEngineCollapsed({
  checkInDate,
  checkOutDate,
  onExpand,
}: BookingEngineCollapsedProps) {
  return (
    <div className="booking-engine-collapsed">
      <div className="booking-collapsed-main">
        <div className="booking-dates-display">
          <button
            type="button"
            onClick={onExpand}
            className="booking-date-button"
            aria-label="Select check-in date"
          >
            <span className="booking-date-value">
              {checkInDate ? format(checkInDate, "d MMM yyyy") : "Select date"}
            </span>
          </button>

          <span className="booking-date-separator">→</span>

          <button
            type="button"
            onClick={onExpand}
            className="booking-date-button"
            aria-label="Select check-out date"
          >
            <span className="booking-date-value">
              {checkOutDate ? format(checkOutDate, "d MMM yyyy") : "Select date"}
            </span>
          </button>

          <button
            type="button"
            onClick={onExpand}
            className="booking-book-button"
            aria-label="Book selected dates"
          >
            book
          </button>
        </div>

        <BookingPricing />
      </div>
    </div>
  );
}
