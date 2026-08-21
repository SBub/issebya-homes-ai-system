import { BookingPricing } from "./BookingPricing";

export function BookingEngineSkeleton() {
  return (
    <div className="booking-engine">
      <div className="booking-engine-collapsed">
        <div className="booking-collapsed-main">
          <div className="booking-dates-display animate-pulse">
            <div className="px-3 py-2 border border-gray-300 bg-background">
              <span className="booking-date-value text-gray-400">check-in</span>
            </div>

            <span className="booking-date-separator text-gray-300">→</span>

            <div className="px-3 py-2 border border-gray-300 bg-background">
              <span className="booking-date-value text-gray-400">check-out</span>
            </div>
          </div>

          <BookingPricing />
        </div>
      </div>
    </div>
  );
}
