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

  const { data: bookings, error } = await supabase
    .from("booking_availability")
    .select("id, check_in, check_out, created_at")
    .eq("room_type", room)
    .eq("status", "confirmed");

  if (error) {
    console.error("Error fetching bookings for iCal:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch bookings" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const icalString = generateICalFeed(bookings ?? []);

  return new Response(icalString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `attachment; filename="${room}.ics"`,
    },
  });
}
