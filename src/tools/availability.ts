import type pg from "pg";
import { z } from "zod";

export const availabilitySnapshotSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  availableNightsNext30d: z.number().int(),
  occupancyRateNext30d: z.number(),
  lastUpdated: z.coerce.date(),
});

export type AvailabilitySnapshot = z.infer<typeof availabilitySnapshotSchema>;

export async function fetchAvailability(pool: pg.Pool): Promise<AvailabilitySnapshot[]> {
  const { rows } = await pool.query(`
    select property_id, property_name, available_nights_next_30d,
           occupancy_rate_next_30d, last_updated
    from booking_availability
  `);
  return rows.map((row) =>
    availabilitySnapshotSchema.parse({
      propertyId: row.property_id,
      propertyName: row.property_name,
      availableNightsNext30d: row.available_nights_next_30d,
      occupancyRateNext30d: row.occupancy_rate_next_30d,
      lastUpdated: row.last_updated,
    }),
  );
}
