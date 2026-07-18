import type pg from "pg";
import { z } from "zod";

export const financeSnapshotSchema = z.object({
  propertyId: z.string(),
  revenueMonthToDate: z.number(),
  outstandingPayouts: z.number(),
  lastUpdated: z.coerce.date(),
});

export type FinanceSnapshot = z.infer<typeof financeSnapshotSchema>;

export async function fetchFinance(pool: pg.Pool): Promise<FinanceSnapshot[]> {
  const { rows } = await pool.query(`
    select property_id, revenue_month_to_date, outstanding_payouts, last_updated
    from finance_bookings
  `);
  return rows.map((row) =>
    financeSnapshotSchema.parse({
      propertyId: row.property_id,
      revenueMonthToDate: row.revenue_month_to_date,
      outstandingPayouts: row.outstanding_payouts,
      lastUpdated: row.last_updated,
    }),
  );
}
