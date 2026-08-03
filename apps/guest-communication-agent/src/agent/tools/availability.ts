import { tool } from "ai";
import { z } from "zod";

function datesOverlap(reqStart: Date, reqEnd: Date, bookedStart: Date, bookedEnd: Date): boolean {
  return reqStart < bookedEnd && reqEnd > bookedStart;
}

// Calls the live GET /api/availability?room= endpoint (which has its own
// 1-hour in-memory cache server-side) rather than duplicating apps/website's
// iCal/availability parsing here.
//
// No per-turn context needed, so this stays a single module-level instance —
// see pricing.ts's own comment for why that's safe.
export const checkAvailability = tool({
  description:
    "Check if a room is available for the requested dates. Use when the guest mentions specific check-in and check-out dates.",
  inputSchema: z.object({
    room: z.enum(["room1", "room2"]).describe("Which room to check"),
    checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
    checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
  }),
  execute: async ({ room, checkIn, checkOut }) => {
    const reqStart = new Date(checkIn);
    const reqEnd = new Date(checkOut);

    if (Number.isNaN(reqStart.getTime()) || Number.isNaN(reqEnd.getTime())) {
      return { available: false, error: "Invalid date format" };
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
    const res = await fetch(`${siteUrl}/api/availability?room=${room}`);
    if (!res.ok) {
      throw new Error(`GET /api/availability?room=${room} failed with status ${res.status}`);
    }
    const { bookings } = (await res.json()) as {
      bookings: { start: string; end: string }[];
    };

    const conflict = bookings.find((b) =>
      datesOverlap(reqStart, reqEnd, new Date(b.start), new Date(b.end)),
    );

    return { available: !conflict, room, checkIn, checkOut };
  },
});
