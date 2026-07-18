import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { pool } from "@/lib/finance/db";
import { airbnbGuestPaid } from "@/lib/finance/formulas";

export const runtime = "nodejs";

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
    // Same monthly cadence and per-platform date attribution as Modelo 30
    // (booked_date for Airbnb, checkout_date for Booking.com) — a documented
    // default per docs/finance/invoices-filing.md, since this report's own
    // cadence wasn't pinned to a specific date field independently.
    const result = await pool.query<{
      guest_name: string;
      checkin_date: string;
      checkout_date: string;
      room: string;
      platform: string;
      gross_room_income: string;
    }>(
      `SELECT guest_name, checkin_date, checkout_date, room, platform, gross_room_income
       FROM finance_bookings
       WHERE status = 'completed' AND (
         (platform = 'airbnb' AND booked_date >= $1 AND booked_date <= $2)
         OR (platform = 'booking_com' AND checkout_date >= $1 AND checkout_date <= $2)
       )
       ORDER BY checkin_date`,
      [start, end],
    );

    const reservations = result.rows.map((row) => {
      const grossRoomIncome = parseFloat(row.gross_room_income);
      // Airbnb: guest_paid = gross_room_income × 1.168 (verified guest
      // service fee multiplier). Booking.com: guest_paid = gross_room_income
      // directly — flagged, NOT fully verified against a raw CSV row (their
      // guest-facing price is assumed to have no separate guest fee, per
      // docs/finance/invoices-filing.md).
      const guestPaid =
        row.platform === "airbnb" ? airbnbGuestPaid(grossRoomIncome) : grossRoomIncome;
      return {
        guest_name: row.guest_name,
        checkin_date: row.checkin_date,
        checkout_date: row.checkout_date,
        room: row.room,
        guest_paid: guestPaid,
      };
    });

    return NextResponse.json({ reservations, count: reservations.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  }
}
