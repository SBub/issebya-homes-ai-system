import pg from "pg";

// node-postgres returns `date` columns as JS Date objects by default, which
// re-interprets them in the process's local timezone and can shift the
// calendar day (e.g. a UTC-stored 2026-07-01 rendering as 2026-06-30
// locally). Force raw "YYYY-MM-DD" strings instead — safe, since Postgres
// always renders `date` as ISO-format text on the wire. OID 1082 = `date`.
pg.types.setTypeParser(1082, (value: string) => value);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

function createPool(connString: string): pg.Pool {
  return new pg.Pool({ connectionString: connString, max: 5 });
}

export const pool = createPool(connectionString);

const NUMERIC_FIELDS = [
  "gross_room_income",
  "platform_fee",
  "net_received",
  "tourist_tax",
  "net_after_tourist",
  "cleaning_cost",
  "actual_profit",
  "irs_taxable_base",
  "commission_amount",
] as const;

/**
 * node-postgres returns `numeric` columns as strings (to avoid float
 * precision loss on the wire) — convert the known numeric fields on a
 * finance_bookings row back to JS numbers for JSON responses.
 */
export function normalizeBookingRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const field of NUMERIC_FIELDS) {
    const value = out[field];
    if (typeof value === "string") out[field] = parseFloat(value);
  }
  return out;
}
