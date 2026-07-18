import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { pool } from "@/lib/finance/db";

export const runtime = "nodejs";

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

function roomLabel(room: string): string {
  return room === "room_1" ? "Room 1" : "Room 2";
}

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const quarter = Number(searchParams.get("quarter"));
  const year = Number(searchParams.get("year"));

  if (!quarter || !year || quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: "Required: quarter (1–4) and year" }, { status: 400 });
  }

  const [startSuffix, endSuffix] = QUARTER_DATES[quarter];
  const startDate = `${year}-${startSuffix}`;
  const endDate = `${year}-${endSuffix}`;

  try {
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
    const csvLines = ["Date,Room,Total nights paid,People,Total"];

    for (const row of rows) {
      const nightsCapped = Math.min(row.nights, 3);
      const amount = 2 * row.guests * nightsCapped;
      total += amount;
      csvLines.push(
        `${formatDateRange(row.checkin_date, row.checkout_date)},${roomLabel(row.room)},${nightsCapped},${row.guests},${amount}`,
      );
    }

    csvLines.push(",,,,");
    csvLines.push(`,,,Total,${total}`);

    const csv = csvLines.join("\n");
    const filename = `tourist-tax-Q${quarter}-${year}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  }
}
