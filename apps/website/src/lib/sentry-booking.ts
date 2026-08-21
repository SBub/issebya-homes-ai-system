import * as Sentry from "@sentry/nextjs";

export type BookingContext = {
  roomType?: "room1" | "room2";
  checkIn?: string;
  checkOut?: string;
  personCount?: number;
  email?: string;
  stripeSessionId?: string;
  nights?: number;
  totalAmount?: number;
};

/**
 * Set booking context on the current Sentry scope.
 * Also sets tags for filtering in Sentry UI.
 */
export function setBookingContext(context: BookingContext) {
  Sentry.setContext("booking", context);

  if (context.roomType) Sentry.setTag("booking.roomType", context.roomType);
  if (context.stripeSessionId) Sentry.setTag("booking.sessionId", context.stripeSessionId);
}

/**
 * Add a breadcrumb in the "booking" category.
 */
export function addBookingBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info",
) {
  Sentry.addBreadcrumb({
    category: "booking",
    message,
    data,
    level,
  });
}

/**
 * Capture a booking-specific error with full context.
 */
export function captureBookingError(
  error: Error,
  context: BookingContext,
  extra?: Record<string, unknown>,
) {
  Sentry.withScope((scope) => {
    scope.setContext("booking", context);
    scope.setTag("flow", "booking");
    if (context.roomType) scope.setTag("booking.roomType", context.roomType);
    if (context.stripeSessionId) scope.setTag("booking.sessionId", context.stripeSessionId);
    if (extra) {
      Object.entries(extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    Sentry.captureException(error);
  });
}
