import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { pool } from "@/lib/finance/db";
import { notionConfigured, syncBookings } from "@/lib/finance/notion";
import { detectPlatform, parseAirbnb, parseBookingCom } from "@/lib/finance/parsers";
import type { FinanceBooking } from "@/lib/finance/types";

export const runtime = "nodejs";

const INSERT_SQL = `
  INSERT INTO finance_bookings (
    booking_id, platform, room, guest_name, checkin_date, checkout_date, booked_date,
    nights, guests, gross_room_income, platform_fee, net_received, tourist_tax,
    net_after_tourist, cleaning_cost, actual_profit, irs_taxable_base, status, commission_amount
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  ON CONFLICT (booking_id) DO UPDATE SET
    platform = EXCLUDED.platform,
    room = EXCLUDED.room,
    guest_name = EXCLUDED.guest_name,
    checkin_date = EXCLUDED.checkin_date,
    checkout_date = EXCLUDED.checkout_date,
    booked_date = EXCLUDED.booked_date,
    nights = EXCLUDED.nights,
    guests = EXCLUDED.guests,
    gross_room_income = EXCLUDED.gross_room_income,
    platform_fee = EXCLUDED.platform_fee,
    net_received = EXCLUDED.net_received,
    tourist_tax = EXCLUDED.tourist_tax,
    net_after_tourist = EXCLUDED.net_after_tourist,
    cleaning_cost = EXCLUDED.cleaning_cost,
    actual_profit = EXCLUDED.actual_profit,
    irs_taxable_base = EXCLUDED.irs_taxable_base,
    status = EXCLUDED.status,
    commission_amount = EXCLUDED.commission_amount
  RETURNING booking_id, platform;
`;

function bookingParams(b: FinanceBooking): unknown[] {
  return [
    b.booking_id,
    b.platform,
    b.room,
    b.guest_name,
    b.checkin_date,
    b.checkout_date,
    b.booked_date,
    b.nights,
    b.guests,
    b.gross_room_income,
    b.platform_fee,
    b.net_received,
    b.tourist_tax,
    b.net_after_tourist,
    b.cleaning_cost,
    b.actual_profit,
    b.irs_taxable_base,
    b.status,
    b.commission_amount,
  ];
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const formData = await request.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);

  // "should support 2 of these csv uploads" — both required, not an
  // either-or single-file endpoint.
  if (files.length !== 2) {
    return NextResponse.json(
      { error: "Exactly 2 files required: one Airbnb CSV and one Booking.com CSV" },
      { status: 400 },
    );
  }

  const allBookings: FinanceBooking[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const text = await file.text();
    try {
      const platform = detectPlatform(text);
      const bookings = platform === "airbnb" ? parseAirbnb(text) : parseBookingCom(text);
      allBookings.push(...bookings);
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : "parse error"}`);
    }
  }

  if (allBookings.length === 0) {
    return NextResponse.json({ error: "No bookings parsed", errors }, { status: 400 });
  }

  const client = await pool.connect();
  const upserted: { booking_id: string; platform: string }[] = [];
  try {
    await client.query("BEGIN");
    for (const booking of allBookings) {
      const result = await client.query(INSERT_SQL, bookingParams(booking));
      upserted.push(result.rows[0]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  const byPlatform = upserted.reduce<Record<string, number>>((acc, row) => {
    acc[row.platform] = (acc[row.platform] ?? 0) + 1;
    return acc;
  }, {});

  // Postgres is the source of truth and already committed above — Notion
  // sync is best-effort and never rolls back the DB write. Failures are
  // reported, not swallowed, so a sync problem doesn't silently drift from
  // what's actually stored.
  let notionWarnings: string[] | undefined;
  if (notionConfigured()) {
    const syncResults = await syncBookings(allBookings);
    const failures = syncResults.filter((r) => !r.ok);
    if (failures.length > 0) {
      notionWarnings = failures.map((f) => `${f.bookingId}: ${f.error}`);
    }
  }

  return NextResponse.json({
    bookings_upserted: upserted.length,
    by_platform: byPlatform,
    errors: errors.length > 0 ? errors : undefined,
    notion_warnings: notionWarnings,
  });
}
