import { z } from "zod";

export const financeSnapshotSchema = z.object({
  propertyId: z.string(),
  revenueMonthToDate: z.number(),
  outstandingPayouts: z.number(),
  lastUpdated: z.coerce.date(),
});

export type FinanceSnapshot = z.infer<typeof financeSnapshotSchema>;

// STUB: no Postgres wired up yet — returns fixed sample data instead of
// querying `finance_bookings`. Swap back to a real query once DATABASE_URL
// points at a reachable Postgres with that table.
export async function fetchFinance(): Promise<FinanceSnapshot[]> {
  return [
    {
      propertyId: "prop-1",
      revenueMonthToDate: 4200,
      outstandingPayouts: 850,
      lastUpdated: new Date(),
    },
  ];
}
