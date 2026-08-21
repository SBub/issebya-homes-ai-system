import { addBreadcrumb, captureException, startSpan } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { mergeMultipleFeeds } from "@/lib/ical-parser";
import { createClient } from "@/lib/shared/supabase";
import type { DateRange } from "@/lib/shared/types/booking";

// In-memory cache with 1-hour TTL
type CacheEntry = {
  data: {
    bookings: DateRange[];
    error?: string;
  };
  timestamp: number;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

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

  return bookings.map((b) => ({
    start: new Date(b.check_in),
    end: new Date(b.check_out),
  }));
}

const VALID_ROOMS = ["room1", "room2"];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const room = searchParams.get("room");

  return startSpan(
    {
      name: "api.availability",
      op: "http.server",
      attributes: {
        "http.route": "/api/availability",
        "booking.roomType": room || "unknown",
      },
    },
    async (parentSpan) => {
      try {
        // Validate room parameter
        if (!room || !VALID_ROOMS.includes(room)) {
          parentSpan?.setStatus({ code: 2, message: "Invalid room parameter" });
          return NextResponse.json(
            { error: "Invalid room parameter. Must be 'room1' or 'room2'." },
            { status: 400 },
          );
        }

        // Get iCal feeds from environment variables
        const roomFeeds = getRoomICalFeeds(room);
        if (roomFeeds.length === 0) {
          console.warn(`No iCal feeds configured for ${room}`);
        }

        // Check cache (skip if fresh=true query param)
        const skipCache = searchParams.get("fresh") === "true";
        const cacheKey = room;
        const cachedEntry = cache.get(cacheKey);
        const now = Date.now();

        if (!skipCache && cachedEntry && now - cachedEntry.timestamp < CACHE_TTL) {
          parentSpan?.setAttribute("cache.hit", true);
          return NextResponse.json(cachedEntry.data);
        }

        parentSpan?.setAttribute("cache.hit", false);

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

        parentSpan?.setAttribute("availability.bookingCount", bookings.length);
        parentSpan?.setAttribute("availability.feedErrors", errors.length);
        parentSpan?.setAttribute("availability.ownBookings", ownBookings.length);

        // Prepare response
        const responseData: {
          bookings: DateRange[];
          error?: string;
        } = {
          bookings,
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

        // Update cache
        cache.set(cacheKey, {
          data: responseData,
          timestamp: now,
        });

        return NextResponse.json(responseData);
      } catch (error) {
        parentSpan?.setStatus({ code: 2, message: "Internal error" });
        captureException(error, {
          tags: { "booking.roomType": room || "unknown" },
        });
        return NextResponse.json(
          {
            bookings: [],
            error: "Unable to fetch availability data. Please try again later.",
          },
          { status: 500 },
        );
      }
    },
  );
}
