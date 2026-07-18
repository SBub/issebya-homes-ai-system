import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { pool } from "@/lib/finance/db";
import { airbnbBaseCommission } from "@/lib/finance/formulas";
import { round2 } from "@/lib/finance/round";

export const runtime = "nodejs";

// Confirmed first-party from real Airbnb/Booking.com invoices — see
// docs/finance/modelo-30-filing.md.
const TAX_IDS = {
  airbnb: "IE9827384L",
  booking_com: "NL805734958B01",
} as const;

function monthRange(year: number, month: number): [string, string] {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return [start, end];
}

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "Required: month (1–12) and year" }, { status: 400 });
  }

  const [start, end] = monthRange(year, month);

  try {
    // Airbnb: base commission (VAT-excl., Modelo 30 value) = gross_room_income
    // × 0.03, attributed by booked_date (the reservation-creation date Airbnb
    // invoices the host service fee against) — see
    // docs/finance/modelo-30-filing.md. Rounded per booking then summed, to
    // match how Airbnb's own invoices round the fee per reservation.
    const airbnbRows = await pool.query<{ gross_room_income: string }>(
      `SELECT gross_room_income FROM finance_bookings
       WHERE platform = 'airbnb' AND status = 'completed'
         AND booked_date >= $1 AND booked_date <= $2`,
      [start, end],
    );
    const airbnbCommissions = airbnbRows.rows.map((r) =>
      airbnbBaseCommission(parseFloat(r.gross_room_income)),
    );
    const airbnbTotal = round2(airbnbCommissions.reduce((sum, c) => sum + c, 0));
    const airbnbCount = airbnbCommissions.length;

    // Booking.com: commission_amount is already the VAT-exclusive base
    // (reverse-charge invoice) — use directly, attributed by checkout_date
    // ("our invoices are based on departure date, not arrival date").
    const bookingComResult = await pool.query<{ total: string; count: string }>(
      `SELECT COALESCE(SUM(commission_amount), 0) AS total, COUNT(*) AS count
       FROM finance_bookings
       WHERE platform = 'booking_com' AND status = 'completed'
         AND checkout_date >= $1 AND checkout_date <= $2`,
      [start, end],
    );
    const bookingComTotal = round2(parseFloat(bookingComResult.rows[0].total));
    const bookingComCount = parseInt(bookingComResult.rows[0].count, 10);

    return NextResponse.json({
      airbnb: { total: airbnbTotal, count: airbnbCount, taxId: TAX_IDS.airbnb },
      booking_com: { total: bookingComTotal, count: bookingComCount, taxId: TAX_IDS.booking_com },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  }
}
