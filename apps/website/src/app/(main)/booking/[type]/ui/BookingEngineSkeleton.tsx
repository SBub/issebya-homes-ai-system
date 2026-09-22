import { BookingPricing } from "./BookingPricing";

// Suspense fallback for BookingEngine (async Server Component). Mirrors
// BookingClient's collapsed-state three-cell layout (check-in, check-out,
// book) so swapping in the resolved content causes minimal layout shift.
export function BookingEngineSkeleton() {
  return (
    <div className="booking-engine">
      <div className="booking-engine-collapsed">
        <div className="booking-collapsed-main">
          <div className="booking-dates-display animate-pulse" data-testid="booking-skeleton-dates">
            <div
              className="booking-date-button border-gray-300"
              data-testid="booking-skeleton-checkin"
            >
              <span className="booking-date-value text-gray-400">Select date</span>
            </div>

            <span className="booking-date-separator text-gray-300">→</span>

            <div
              className="booking-date-button border-gray-300"
              data-testid="booking-skeleton-checkout"
            >
              <span className="booking-date-value text-gray-400">Select date</span>
            </div>

            <div
              className="booking-book-button bg-gray-300 text-gray-400"
              data-testid="booking-skeleton-book"
            >
              book
            </div>
          </div>
        </div>
      </div>

      <BookingPricing />
    </div>
  );
}
