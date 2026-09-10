import { addBreadcrumb, startSpan } from "@sentry/nextjs";
import { cacheLife, cacheTag } from "next/cache";
import { findFirstAvailableNights, fromCalendarDay, mergeDateRanges } from "@/lib/date-utils";
import { mergeMultipleFeeds } from "@/lib/ical-parser";
import { createClient } from "@/lib/shared/supabase";
import type { DateRange } from "@/lib/shared/types/booking";

export const VALID_ROOMS = ["room1", "room2"];

// Build room iCal feed URLs from environment variables
function getRoomICalFeeds(room: string): string[] {
  const prefix = room.toUpperCase(); // ROOM1 or ROOM2
  const feeds: string[] = [];

  const airbnb = process.env[`${prefix}_ICAL_AIRBNB`];
  const vrbo = process.env[`${prefix}_ICAL_VRBO`];
  const booking = process.env[`${prefix}_ICAL_BOOKING`];

  if (airbnb) feeds.push(airbnb);
  if (vrbo) feeds.push(vrbo);
  if (booking) feeds.push(booking);

  return feeds;
}

async function getOwnBookings(room: string): Promise<DateRange[]> {
  const supabase = createClient();
  const { data: bookings, error } = await supabase
    .from("booking_availability")
    .select("check_in, check_out")
    .eq("room_type", room);

  if (error || !bookings) return [];

  // check_in/check_out are date-only Postgres columns, i.e. calendar days.
  // A bare `new Date("2026-09-21")` would parse them as UTC midnight, while
  // every consumer here (isDateBlocked, mergeDateRanges) normalises with
  // startOfDay, which is local — off-UTC that is a day's worth of drift.
  return bookings.map((b) => ({
    start: fromCalendarDay(b.check_in),
    end: fromCalendarDay(b.check_out),
  }));
}

export async function getAvailability(room: string): Promise<{
  bookings: DateRange[];
  firstAvailable: DateRange | null;
  error?: string;
}> {
  "use cache";
  cacheLife("minutes");
  cacheTag("availability", `availability-${room}`);

  return startSpan(
    {
      name: "api.availability",
      op: "http.server",
      attributes: {
        "http.route": "/api/availability",
        "booking.roomType": room,
      },
    },
    async (parentSpan) => {
      // Get iCal feeds from environment variables
      const roomFeeds = getRoomICalFeeds(room);
      if (roomFeeds.length === 0) {
        console.warn(`No iCal feeds configured for ${room}`);
      }

      // Fetch iCal feeds and own bookings in parallel
      const [icalResult, ownBookings] = await Promise.all([
        startSpan(
          {
            name: "ical.fetch_feeds",
            op: "http.client",
            attributes: {
              "booking.roomType": room,
              "ical.feedCount": roomFeeds.length,
            },
          },
          async () => mergeMultipleFeeds(roomFeeds),
        ),
        startSpan(
          {
            name: "db.fetch_own_bookings",
            op: "db.query",
            attributes: { "booking.roomType": room },
          },
          async () => getOwnBookings(room),
        ),
      ]);

      const { bookings: icalBookings, errors } = icalResult;

      const bookings = [...icalBookings, ...ownBookings];
      const blockedDates = mergeDateRanges(bookings);
      const firstAvailable = findFirstAvailableNights(blockedDates, 2);

      parentSpan?.setAttribute("availability.bookingCount", bookings.length);
      parentSpan?.setAttribute("availability.feedErrors", errors.length);
      parentSpan?.setAttribute("availability.ownBookings", ownBookings.length);

      // Prepare response
      const responseData: {
        bookings: DateRange[];
        firstAvailable: DateRange | null;
        error?: string;
      } = {
        bookings,
        firstAvailable,
      };

      // Add error message if some feeds failed
      if (errors.length > 0) {
        responseData.error = `Some availability data could not be fetched: ${errors.length} feed(s) failed.`;
        addBreadcrumb({
          category: "ical",
          message: "Some iCal feeds failed",
          data: { errors: errors.length, room },
          level: "warning",
        });
      }

      return responseData;
    },
  );
}
