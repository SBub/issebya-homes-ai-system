import { captureException } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { getAvailability, VALID_ROOMS } from "@/lib/availability";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const room = searchParams.get("room");

  // Validate room parameter
  if (!room || !VALID_ROOMS.includes(room)) {
    return NextResponse.json(
      { error: "Invalid room parameter. Must be 'room1' or 'room2'." },
      { status: 400 },
    );
  }

  try {
    const responseData = await getAvailability(room);
    return NextResponse.json(responseData);
  } catch (error) {
    captureException(error, {
      tags: { "booking.roomType": room },
    });
    return NextResponse.json(
      {
        bookings: [],
        error: "Unable to fetch availability data. Please try again later.",
      },
      { status: 500 },
    );
  }
}
