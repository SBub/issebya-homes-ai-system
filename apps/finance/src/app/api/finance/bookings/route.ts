import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { normalizeBookingRow, pool } from "@/lib/finance/db";

export const runtime = "nodejs";

const QUARTER_DATES: Record<number, [string, string]> = {
  1: ["01-01", "03-31"],
  2: ["04-01", "06-30"],
  3: ["07-01", "09-30"],
  4: ["10-01", "12-31"],
};

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year");
  const quarter = searchParams.get("quarter");
  const platform = searchParams.get("platform");
  const room = searchParams.get("room");

  const quarterNum = quarter ? Number(quarter) : null;
  if (quarter && (!year || !quarterNum || quarterNum < 1 || quarterNum > 4)) {
    return NextResponse.json({ error: "quarter requires year and must be 1–4" }, { status: 400 });
  }

  const conditions: string[] = ["status = 'completed'"];
  const params: unknown[] = [];

  if (year && quarterNum) {
    const [startSuffix, endSuffix] = QUARTER_DATES[quarterNum];
    params.push(`${year}-${startSuffix}`);
    conditions.push(`checkin_date >= $${params.length}`);
    params.push(`${year}-${endSuffix}`);
    conditions.push(`checkin_date <= $${params.length}`);
  } else if (year) {
    params.push(`${year}-01-01`);
    conditions.push(`checkin_date >= $${params.length}`);
    params.push(`${year}-12-31`);
    conditions.push(`checkin_date <= $${params.length}`);
  }

  if (platform) {
    params.push(platform);
    conditions.push(`platform = $${params.length}`);
  }
  if (room) {
    params.push(room);
    conditions.push(`room = $${params.length}`);
  }

  const sql = `SELECT * FROM finance_bookings WHERE ${conditions.join(" AND ")} ORDER BY checkin_date DESC`;

  try {
    const result = await pool.query(sql, params);
    const bookings = result.rows.map(normalizeBookingRow);
    return NextResponse.json({ bookings, count: bookings.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  }
}
