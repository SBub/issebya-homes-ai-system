/**
 * The "booking is unavailable" sentence, split around `<WhatsAppLink />`.
 * Render it as `{lead}<WhatsAppLink />{tail}` with nothing between the three
 * children, or the spacing drifts. Shared by `GuardedBookingEngine`'s error
 * fallback and `BookingClient`'s availability-error state so the wording
 * cannot diverge between them.
 */
export const BOOKING_UNAVAILABLE_COPY = {
  lead: "Booking is temporarily unavailable. Please reach out to us on ",
  tail: " to book directly.",
} as const;
