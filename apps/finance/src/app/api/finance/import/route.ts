import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { pool } from "@/lib/finance/db";
import { guestContactsSyncConfigured, syncGuestContacts } from "@/lib/finance/guest-contacts";
import { notionConfigured, syncBookings } from "@/lib/finance/notion";
import { detectPlatform, parseAirbnb, parseBookingCom } from "@/lib/finance/parsers";
import {
  buildImportMessage,
  distinctModelo30Months,
  invoicesToCsv,
  isQuarterClosingMonth,
  monthToQuarter,
} from "@/lib/finance/reports";
import {
  getInvoicesReport,
  getModelo30Summary,
  getTouristTaxReport,
} from "@/lib/finance/reports-db";
import { sendDocument, sendMessage, telegramConfigured } from "@/lib/finance/telegram";
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

  // At least 1 file required — no fixed count. Booking.com only exports
  // monthly, per-room CSVs (unlike Airbnb's single combined export), so a
  // real upload batch is often 1 Airbnb file + many Booking.com files.
  // Platform is auto-detected per file below, so any mix works.
  if (files.length < 1) {
    return NextResponse.json({ error: "At least 1 CSV file is required" }, { status: 400 });
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

  // Telegram delivery: announce which reports are now ready for every
  // distinct (year, month) this upload batch touched, with the Modelo 30
  // numbers and invoices CSV delivered directly (plus the tourist-tax CSV
  // when that month closes a quarter). Best-effort like Notion sync above —
  // Postgres already committed, so a delivery failure here is collected and
  // reported, never thrown, and never rolls back anything.
  let telegramWarnings: string[] | undefined;
  if (telegramConfigured()) {
    const months = distinctModelo30Months(allBookings);
    const warnings: string[] = [];

    for (const { year, month } of months) {
      const label = `${year}-${String(month).padStart(2, "0")}`;
      try {
        const modelo30 = await getModelo30Summary(year, month);
        const invoicesReport = await getInvoicesReport(year, month);
        const invoicesCsv = invoicesToCsv(invoicesReport.reservations);
        const invoicesFilename = `invoices-${label}.csv`;

        let touristTax: { quarter: number; filename: string; csv: string } | undefined;
        if (isQuarterClosingMonth(month)) {
          const quarter = monthToQuarter(month);
          const touristTaxReport = await getTouristTaxReport(quarter, year);
          touristTax = { quarter, filename: touristTaxReport.filename, csv: touristTaxReport.csv };
        }

        const text = buildImportMessage({
          year,
          month,
          modelo30,
          invoicesFilename,
          touristTax: touristTax && { quarter: touristTax.quarter, filename: touristTax.filename },
        });

        const messageResult = await sendMessage(text);
        if (!messageResult.ok) warnings.push(`${label} message: ${messageResult.error}`);

        const invoicesDocResult = await sendDocument(invoicesFilename, invoicesCsv);
        if (!invoicesDocResult.ok) warnings.push(`${invoicesFilename}: ${invoicesDocResult.error}`);

        if (touristTax) {
          const touristTaxDocResult = await sendDocument(touristTax.filename, touristTax.csv);
          if (!touristTaxDocResult.ok) {
            warnings.push(`${touristTax.filename}: ${touristTaxDocResult.error}`);
          }
        }
      } catch (err) {
        warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (warnings.length > 0) telegramWarnings = warnings;
  }

  // guest_contacts refresh: pushes a "sync now" request to
  // apps/guest-communication-agent so it re-derives guest_contacts from the
  // finance_bookings rows just committed above. Best-effort like Notion sync
  // and Telegram delivery above — Postgres already committed, so a failure
  // here is collected and reported, never thrown, and never rolls back
  // anything.
  let guestContactsSyncWarning: string | undefined;
  if (guestContactsSyncConfigured()) {
    const result = await syncGuestContacts();
    if (!result.ok) guestContactsSyncWarning = result.error;
  }

  return NextResponse.json({
    bookings_upserted: upserted.length,
    by_platform: byPlatform,
    errors: errors.length > 0 ? errors : undefined,
    notion_warnings: notionWarnings,
    telegram_warnings: telegramWarnings,
    guest_contacts_sync_warning: guestContactsSyncWarning,
  });
}
