import { pool } from "./db";
import { airbnbBaseCommission, airbnbGuestPaid } from "./formulas";
import type { InvoicesReport, Modelo30Summary, TouristTaxReport } from "./reports";
import { monthRange, roomLabel } from "./reports";
import { round2 } from "./round";
import type { Room } from "./types";

// The Postgres-backed halves of the three report endpoints (Modelo 30,
// invoices, tourist tax) — split out from reports.ts so that file's pure
// logic (month/quarter detection, CSV/message formatting) stays importable
// without a DATABASE_URL, e.g. from unit tests. Both this file's route
// wrappers (modelo30/route.ts, invoices/route.ts, tourist-tax/route.ts) and
// the post-import Telegram flow (import/route.ts) call these functions —
// single source of truth for the SQL.

// Confirmed first-party from real Airbnb/Booking.com invoices — see
// docs/finance/modelo-30-filing.md.
const TAX_IDS = {
  airbnb: "IE9827384L",
  booking_com: "NL805734958B01",
} as const;

const QUARTER_DATES: Record<number, [string, string]> = {
  1: ["01-01", "03-31"],
  2: ["04-01", "06-30"],
  3: ["07-01", "09-30"],
  4: ["10-01", "12-31"],
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateRange(checkin: string, checkout: string): string {
  const ci = new Date(checkin);
  const co = new Date(checkout);
  // ISO date-only strings parse as UTC midnight — use UTC accessors to avoid timezone shift.
  return `${pad(ci.getUTCDate())}.${pad(ci.getUTCMonth() + 1)}-${pad(co.getUTCDate())}.${pad(co.getUTCMonth() + 1)}`;
}

/**
 * Airbnb: base commission (VAT-excl., Modelo 30 value) = gross_room_income ×
 * 0.03, attributed by booked_date (the reservation-creation date Airbnb
 * invoices the host service fee against) — see docs/finance/modelo-30-filing.md.
 * Rounded per booking then summed, to match how Airbnb's own invoices round
 * the fee per reservation.
 *
 * Booking.com: commission_amount is already the VAT-exclusive base
 * (reverse-charge invoice) — use directly, attributed by checkout_date ("our
 * invoices are based on departure date, not arrival date").
 */
export async function getModelo30Summary(year: number, month: number): Promise<Modelo30Summary> {
  const [start, end] = monthRange(year, month);

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

  const bookingComResult = await pool.query<{ total: string; count: string }>(
    `SELECT COALESCE(SUM(commission_amount), 0) AS total, COUNT(*) AS count
     FROM finance_bookings
     WHERE platform = 'booking_com' AND status = 'completed'
       AND checkout_date >= $1 AND checkout_date <= $2`,
    [start, end],
  );
  const bookingComTotal = round2(parseFloat(bookingComResult.rows[0].total));
  const bookingComCount = parseInt(bookingComResult.rows[0].count, 10);

  return {
    airbnb: { total: airbnbTotal, count: airbnbCount, taxId: TAX_IDS.airbnb },
    booking_com: { total: bookingComTotal, count: bookingComCount, taxId: TAX_IDS.booking_com },
  };
}

/**
 * Same monthly cadence and per-platform date attribution as Modelo 30
 * (booked_date for Airbnb, checkout_date for Booking.com) — a documented
 * default per docs/finance/invoices-filing.md, since this report's own
 * cadence wasn't pinned to a specific date field independently.
 */
export async function getInvoicesReport(year: number, month: number): Promise<InvoicesReport> {
  const [start, end] = monthRange(year, month);

  const result = await pool.query<{
    guest_name: string;
    checkin_date: string;
    checkout_date: string;
    room: Room;
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
    // Airbnb: guest_paid = gross_room_income × 1.168 (verified guest service
    // fee multiplier). Booking.com: guest_paid = gross_room_income directly —
    // flagged, NOT fully verified against a raw CSV row (their guest-facing
    // price is assumed to have no separate guest fee, per
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

  return { reservations, count: reservations.length };
}

export async function getTouristTaxReport(
  quarter: number,
  year: number,
): Promise<TouristTaxReport> {
  const [startSuffix, endSuffix] = QUARTER_DATES[quarter];
  const startDate = `${year}-${startSuffix}`;
  const endDate = `${year}-${endSuffix}`;

  const result = await pool.query(
    `SELECT checkin_date, checkout_date, room, guests, nights
     FROM finance_bookings
     WHERE platform = 'airbnb' AND status = 'completed'
       AND checkin_date >= $1 AND checkin_date <= $2
     ORDER BY checkin_date`,
    [startDate, endDate],
  );

  const rows = result.rows as {
    checkin_date: string;
    checkout_date: string;
    room: string;
    guests: number;
    nights: number;
  }[];

  let total = 0;
  let totalOvernightStays = 0;
  const csvLines = ["Date,Room,Total nights paid,People,Total"];

  for (const row of rows) {
    const nightsCapped = Math.min(row.nights, 3);
    const amount = 2 * row.guests * nightsCapped;
    total += amount;
    totalOvernightStays += row.guests * nightsCapped;
    csvLines.push(
      `${formatDateRange(row.checkin_date, row.checkout_date)},${roomLabel(row.room)},${nightsCapped},${row.guests},${amount}`,
    );
  }

  csvLines.push(",,,,");
  csvLines.push(`,,,Total,${total}`);
  // The exact figure the Sintra municipal tax portal's "Number of overnight
  // stays subject to tax up to a maximum of 3 nights (€2)" field wants — a
  // count (guests × nights, each booking capped at 3 nights), not a euro
  // amount. total (above) / 2 gives the same number since the rate is a flat
  // €2, but computing it directly here doesn't rely on that coincidence.
  csvLines.push(`,,,Total overnight stays subject to tax,${totalOvernightStays}`);

  return {
    csv: csvLines.join("\n"),
    filename: `tourist-tax-Q${quarter}-${year}.csv`,
    total,
    totalOvernightStays,
  };
}
