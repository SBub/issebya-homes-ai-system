import { Suspense } from "react";
import { ErrorBoundary } from "@sentry/nextjs";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { BOOKING_WIDGET_ANCHOR_ID } from "@/lib/blog/return-path";
import { BookingType } from "@/lib/shared/types/booking";
import { BookingEngine } from "../../booking/[type]/ui/BookingEngine";
import { BookingEngineSkeleton } from "../../booking/[type]/ui/BookingEngineSkeleton";
import { RoomSwitcher } from "./RoomSwitcher";

/**
 * The booking engine, inline in an article.
 *
 * This is a Server Component and an arrangement of existing parts, not a
 * second booking implementation. Each room's node is built exactly as
 * `booking/[type]/page.tsx` builds it: a Sentry `<ErrorBoundary>` with the
 * WhatsApp fallback, wrapping a `<Suspense fallback={<BookingEngineSkeleton/>}>`,
 * wrapping the real `<BookingEngine>`. That `Suspense` boundary is not
 * decorative: `BookingClient` calls `useSearchParams()` and needs one to stay
 * out of the way of static rendering, and the restore-booking-engine-skeleton
 * entry in `app_docs` records why the fallback is the skeleton rather than
 * `null`.
 *
 * Both nodes are passed to the client switcher as props, the same
 * server-into-client interleaving `BookingEngine` already uses for
 * `BookingClient`'s `pricing` prop. That is what puts both rooms' availability
 * into this page's static payload, and it is why switching rooms costs no
 * request.
 *
 * Because the engine is the real one, availability is read through
 * `getAvailability`'s existing `availability-${room}` cache tag, so the Stripe
 * webhook and `api/bookings/direct` invalidate a post's engine exactly as they
 * invalidate the booking page's. Booking from here goes through the same
 * `submitBooking` Server Action and the same Stripe Checkout.
 *
 * The widget takes no room prop: any post converts for either room, so the
 * reader chooses inside the widget.
 *
 * The `<aside>` carries `BOOKING_WIDGET_ANCHOR_ID` because it is the landing
 * target a reader returns to after checkout: both the Stripe cancel URL and
 * the confirmation page's back link point at `/blog/<slug>#book`. A post must
 * therefore render at most one widget — two would be duplicate ids and the
 * browser would land on the first.
 */
function roomEngine(roomType: BookingType) {
  return (
    <ErrorBoundary
      fallback={
        <div className="booking-engine-error">
          <p className="text-sm text-red-600">
            Booking is temporarily unavailable. Please reach out to us on <WhatsAppLink /> to book
            directly.
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

export function BookingWidget() {
  return (
    <aside
      id={BOOKING_WIDGET_ANCHOR_ID}
      className="my-10 border border-dashed p-4 bg-white"
      data-testid="booking-widget"
    >
      <RoomSwitcher room1={roomEngine(BookingType.room1)} room2={roomEngine(BookingType.room2)} />
    </aside>
  );
}
