import { BOOKING_WIDGET_ANCHOR_ID } from "@/lib/blog/return-path";
import { BookingType } from "@/lib/shared/types/booking";
import { GuardedBookingEngine } from "../../booking/[type]/ui/GuardedBookingEngine";
import { RoomSwitcher } from "./RoomSwitcher";

/**
 * The booking engine, inline in an article.
 *
 * This is a Server Component and an arrangement of existing parts, not a
 * second booking implementation. Each room's node is `<GuardedBookingEngine>`,
 * the same component `booking/[type]/page.tsx` renders; see it for why the
 * boundary and the skeleton fallback are there.
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
 *
 * The `<aside>` clears floats, so a post can place it after a floated hero
 * photo and its whole box still starts below the photo.
 */
export function BookingWidget() {
  return (
    <aside
      id={BOOKING_WIDGET_ANCHOR_ID}
      className="my-10 clear-both max-w-xl bg-shop-card text-foreground border border-foreground p-4 md:p-8"
      data-testid="booking-widget"
    >
      <p className="uppercase tracking-[0.2em] text-xs mb-4">Book Your Stay</p>
      <RoomSwitcher
        room1={<GuardedBookingEngine roomType={BookingType.room1} />}
        room2={<GuardedBookingEngine roomType={BookingType.room2} />}
      />
    </aside>
  );
}
