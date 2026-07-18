import { z } from "zod";

export const availabilitySnapshotSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  availableNightsNext30d: z.number().int(),
  occupancyRateNext30d: z.number(),
  lastUpdated: z.coerce.date(),
});

export type AvailabilitySnapshot = z.infer<typeof availabilitySnapshotSchema>;

// STUB: no Postgres wired up yet — returns fixed sample data instead of
// querying `booking_availability`. Swap back to a real query once DATABASE_URL
// points at a reachable Postgres with that table.
export async function fetchAvailability(): Promise<AvailabilitySnapshot[]> {
  return [
    {
      propertyId: "prop-1",
      propertyName: "Sample Villa",
      availableNightsNext30d: 18,
      occupancyRateNext30d: 0.4,
      lastUpdated: new Date(),
    },
  ];
}
