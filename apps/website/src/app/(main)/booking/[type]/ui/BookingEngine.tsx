import { getAvailability } from "@/lib/availability";
import { mergeDateRanges, toCalendarDay } from "@/lib/date-utils";
import { BookingClient } from "./BookingClient";
import { BookingPricing } from "./BookingPricing";

type BookingEngineProps = {
  roomType: "room1" | "room2";
};

// Server Component — getAvailability is "use cache"-tagged (cacheLife("minutes")),
// so calling it here is a cached function call, not an uncached runtime read.
// It does not force dynamic rendering and needs no Suspense boundary of its
// own; this component stays part of the static shell.
export async function BookingEngine({ roomType }: BookingEngineProps) {
  const { bookings, firstAvailable, error } = await getAvailability(roomType);
  const blockedDates = mergeDateRanges(bookings);

  return (
    <BookingClient
      roomType={roomType}
      blockedDates={blockedDates}
      defaultCheckIn={firstAvailable ? toCalendarDay(firstAvailable.start) : null}
      defaultCheckOut={firstAvailable ? toCalendarDay(firstAvailable.end) : null}
      error={error ?? null}
      pricing={<BookingPricing />}
    />
  );
}
