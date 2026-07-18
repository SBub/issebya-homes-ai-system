import { z } from "zod";

export const availabilitySnapshotSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  availableNightsNext30d: z.number().int(),
  occupancyRateNext30d: z.number(),
  lastUpdated: z.coerce.date(),
});

export type AvailabilitySnapshot = z.infer<typeof availabilitySnapshotSchema>;

interface Booking {
  start: string;
  end: string;
}

interface AvailabilityApiResponse {
  bookings: Booking[];
}

const AVAILABILITY_API_URL = "https://www.issebya.com/api/availability";
const HORIZON_DAYS = 30;

const ROOMS = [
  { id: "room1", name: "Room 1" },
  { id: "room2", name: "Room 2" },
] as const;

/** Nights in [now, now + horizonDays) covered by any booking's [start, end) range. */
export function countOccupiedNights(
  bookings: Booking[],
  now: Date,
  horizonDays = HORIZON_DAYS,
): number {
  const dayMs = 24 * 60 * 60 * 1000;
  let occupied = 0;
  for (let i = 0; i < horizonDays; i++) {
    const night = now.getTime() + i * dayMs;
    const isBooked = bookings.some((b) => {
      const start = new Date(b.start).getTime();
      const end = new Date(b.end).getTime();
      return night >= start && night < end;
    });
    if (isBooked) occupied++;
  }
  return occupied;
}

async function fetchRoomAvailability(
  room: (typeof ROOMS)[number],
  now: Date,
): Promise<AvailabilitySnapshot> {
  const response = await fetch(`${AVAILABILITY_API_URL}?room=${room.id}`);
  if (!response.ok) {
    throw new Error(`availability fetch failed for ${room.id}: ${response.status}`);
  }
  const data = (await response.json()) as AvailabilityApiResponse;
  const occupied = countOccupiedNights(data.bookings, now);
  return availabilitySnapshotSchema.parse({
    propertyId: room.id,
    propertyName: room.name,
    availableNightsNext30d: HORIZON_DAYS - occupied,
    occupancyRateNext30d: occupied / HORIZON_DAYS,
    lastUpdated: now,
  });
}

export async function fetchAvailability(): Promise<AvailabilitySnapshot[]> {
  const now = new Date();
  return Promise.all(ROOMS.map((room) => fetchRoomAvailability(room, now)));
}
