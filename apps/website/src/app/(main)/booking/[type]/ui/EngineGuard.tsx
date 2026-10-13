import type { ReactNode } from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "@sentry/nextjs";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { BOOKING_UNAVAILABLE_COPY } from "@/lib/shared/booking-copy";
import { BookingEngineSkeleton } from "./BookingEngineSkeleton";

/**
 * The guards every booking engine renders inside: a Sentry `<ErrorBoundary>`
 * that degrades a throwing engine to a WhatsApp fallback, and a `<Suspense>`
 * whose fallback is `BookingEngineSkeleton` (see `GuardedBookingEngine` for
 * why it is not `null`).
 */
export function EngineGuard({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="booking-engine-error">
          <p className="text-sm text-red-600">
            {BOOKING_UNAVAILABLE_COPY.lead}
            <WhatsAppLink />
            {BOOKING_UNAVAILABLE_COPY.tail}
          </p>
        </div>
      }
    >
      <Suspense fallback={<BookingEngineSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
