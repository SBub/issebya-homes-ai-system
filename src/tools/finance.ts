import { z } from "zod";

export const financeSnapshotSchema = z.object({
  propertyId: z.string(),
  revenueMonthToDate: z.number(),
  outstandingPayouts: z.number(),
  lastUpdated: z.coerce.date(),
});

export type FinanceSnapshot = z.infer<typeof financeSnapshotSchema>;

// STUB: no Postgres wired up yet — returns fixed sample data instead of
// querying `finance_bookings`. Property ids match the real room1/room2 from
// src/tools/availability.ts so the digest stays internally consistent. Swap
// back to a real query once DATABASE_URL points at a reachable Postgres with
// that table.
export async function fetchFinance(): Promise<FinanceSnapshot[]> {
  const now = new Date();
  return [
    { propertyId: "room1", revenueMonthToDate: 2400, outstandingPayouts: 400, lastUpdated: now },
    { propertyId: "room2", revenueMonthToDate: 1800, outstandingPayouts: 450, lastUpdated: now },
  ];
}
