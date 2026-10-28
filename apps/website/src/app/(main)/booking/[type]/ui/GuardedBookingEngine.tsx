import { Suspense } from "react";
import { ErrorBoundary } from "@sentry/nextjs";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { BOOKING_UNAVAILABLE_COPY } from "@/lib/shared/booking-copy";
import type { BookingType } from "@/lib/shared/types/booking";
import { BookingEngine } from "./BookingEngine";
import { BookingEngineSkeleton } from "./BookingEngineSkeleton";

/**
 * The booking engine with its guards, as rendered by both
 * `booking/[type]/page.tsx` and the blog `BookingWidget`.
 *
 * The Sentry `<ErrorBoundary>` degrades a throwing engine to a WhatsApp
 * fallback instead of taking the page down with it.
 *
 * The `<Suspense>` is not decorative: `BookingClient` calls
 * `useSearchParams()` and needs a boundary to stay out of the way of static
 * rendering. Its fallback is `BookingEngineSkeleton` rather than `null`; the
 * restore-booking-engine-skeleton entry in `app_docs`
 * (`feature-675f0da1-restore-booking-engine-skeleton.md`) records why.
 *
 * This is a Server Component because `BookingEngine` is one: it reads the
 * cached availability on the server.
 */
export function GuardedBookingEngine({ roomType }: { roomType: BookingType }) {
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
      <Suspense fallback={<BookingEngineSkeleton />}>
        <BookingEngine roomType={roomType} />
      </Suspense>
    </ErrorBoundary>
  );
}
