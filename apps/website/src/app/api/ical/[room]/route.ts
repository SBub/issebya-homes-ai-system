import { captureException } from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { generateICalFeed } from "@/lib/ical-generator";
import { createClient } from "@/lib/shared/supabase";

const VALID_ROOMS = ["room1", "room2"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;

  if (!VALID_ROOMS.includes(room as (typeof VALID_ROOMS)[number])) {
    return new Response(
      JSON.stringify({
        error: "Invalid room parameter. Must be 'room1' or 'room2'.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient();

  // No `.eq("status", "confirmed")` here on purpose. booking_availability is a
  // view over bookings that already filters `where status = 'confirmed'` and
  // projects only id, room_type, check_in, check_out, created_at. `status` is
  // not exposed, so filtering on it makes PostgREST reject the query (42703),
  // this route 500s, and the OTAs get an empty feed. Re-adding it reintroduces
  // a double-booking risk. Same reasoning as getOwnBookings in lib/availability.ts.
  const { data: bookings, error } = await supabase
    .from("booking_availability")
    .select("id, check_in, check_out, created_at")
    .eq("room_type", room);

  // This route has no human watching it: the only consumers are OTA iCal
  // pollers, and an OTA treats a 500 as "no update", silently keeping the
  // last feed it saw. A broken feed therefore looks identical to a working
  // one from the outside while the calendar drifts out of sync, which is how
  // the `status` filter above survived unnoticed. console.error alone never
  // surfaces anywhere, so every failure path reports to Sentry.
  if (error) {
    console.error("Error fetching bookings for iCal:", error);
    captureException(error, {
      tags: { "db.operation": "ical_feed_fetch", "booking.roomType": room },
    });
    return new Response(JSON.stringify({ error: "Failed to fetch bookings" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let icalString: string;
  try {
    icalString = generateICalFeed(bookings ?? []);
  } catch (generateError) {
    console.error("Error generating iCal feed:", generateError);
    captureException(generateError, {
      tags: { "ical.operation": "generate_feed", "booking.roomType": room },
      extra: { bookingCount: bookings?.length ?? 0 },
    });
    return new Response(JSON.stringify({ error: "Failed to generate iCal feed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(icalString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `attachment; filename="${room}.ics"`,
    },
  });
}
