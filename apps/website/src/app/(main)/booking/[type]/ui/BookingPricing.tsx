import { ROOM_PRICING } from "pricing";

export function BookingPricing() {
  return (
    <div className="booking-pricing-info">
      <span className="booking-price-per-night">{ROOM_PRICING.basePrice}€ / night</span>
    </div>
  );
}
