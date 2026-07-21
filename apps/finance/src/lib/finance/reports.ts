import type { FinanceBooking, Room } from "./types";

// Pure report-shaping logic — deliberately free of any DB import (see
// reports-db.ts for the actual queries) so this file can be unit-tested
// without DATABASE_URL being set, same as formulas.ts/parsers.ts.

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthRange(year: number, month: number): [string, string] {
  const start = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${pad(month)}-${pad(lastDay)}`;
  return [start, end];
}

export function roomLabel(room: string): string {
  return room === "room_1" ? "Room 1" : "Room 2";
}

/** "July 2026" — used in Telegram confirmation messages. */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Modelo 30 (src/app/api/finance/modelo30/route.ts wraps getModelo30Summary,
// in reports-db.ts, which returns this shape)
// ---------------------------------------------------------------------------

interface Modelo30PlatformSummary {
  total: number;
  count: number;
  taxId: string;
}

export interface Modelo30Summary {
  airbnb: Modelo30PlatformSummary;
  booking_com: Modelo30PlatformSummary;
}

// ---------------------------------------------------------------------------
// Invoices (src/app/api/finance/invoices/route.ts wraps getInvoicesReport,
// in reports-db.ts, which returns this shape)
// ---------------------------------------------------------------------------

export interface InvoiceReservation {
  guest_name: string;
  checkin_date: string;
  checkout_date: string;
  room: Room;
  guest_paid: number;
}

export interface InvoicesReport {
  reservations: InvoiceReservation[];
  count: number;
}

/** Guest names + amounts paid, for Portal das Finanças — the Telegram document attachment. */
export function invoicesToCsv(reservations: InvoiceReservation[]): string {
  const lines = ["Guest name,Check-in,Check-out,Room,Amount paid"];
  for (const r of reservations) {
    lines.push(
      `${r.guest_name},${r.checkin_date},${r.checkout_date},${roomLabel(r.room)},${r.guest_paid}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tourist tax (src/app/api/finance/tourist-tax/route.ts wraps
// getTouristTaxReport, in reports-db.ts, which returns this shape)
// ---------------------------------------------------------------------------

export interface TouristTaxReport {
  csv: string;
  filename: string;
  total: number;
  /** Sum of guests × min(nights, 3) across qualifying bookings — the exact
   * count the Sintra municipal tax portal's "Number of overnight stays
   * subject to tax up to a maximum of 3 nights (€2)" field wants. */
  totalOvernightStays: number;
}

// ---------------------------------------------------------------------------
// Month/quarter detection — pure, no DB — for the post-import Telegram flow.
// ---------------------------------------------------------------------------

export interface MonthYear {
  year: number;
  month: number;
}

function parseYearMonth(isoDate: string): MonthYear {
  const [y, m] = isoDate.split("-");
  return { year: Number(y), month: Number(m) };
}

/**
 * Distinct (year, month) pairs touched by this upload batch, keyed off each
 * booking's Modelo-30-attribution date field: booked_date for Airbnb,
 * checkout_date for Booking.com. Bookings with a null attribution date are
 * skipped (can't be assigned to a month). Sorted chronologically so a
 * historical backfill produces messages in date order.
 */
export function distinctModelo30Months(bookings: FinanceBooking[]): MonthYear[] {
  const seen = new Map<string, MonthYear>();
  for (const booking of bookings) {
    const attributionDate =
      booking.platform === "airbnb" ? booking.booked_date : booking.checkout_date;
    if (!attributionDate) continue;
    const my = parseYearMonth(attributionDate);
    const key = `${my.year}-${my.month}`;
    if (!seen.has(key)) seen.set(key, my);
  }
  return Array.from(seen.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}

/** Jan-Mar=1, Apr-Jun=2, Jul-Sep=3, Oct-Dec=4. */
export function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

/** March, June, September, December each complete a quarter. */
export function isQuarterClosingMonth(month: number): boolean {
  return month % 3 === 0;
}

// ---------------------------------------------------------------------------
// Telegram message composition — pure, given already-fetched report data.
// ---------------------------------------------------------------------------

export interface BuildImportMessageParams {
  year: number;
  month: number;
  modelo30: Modelo30Summary;
  invoicesFilename: string;
  touristTax?: { quarter: number; filename: string };
}

export function buildImportMessage(params: BuildImportMessageParams): string {
  const { year, month, modelo30, invoicesFilename, touristTax } = params;
  const monthLabel = formatMonthYear(year, month);

  const lines = [
    `📋 Import complete for ${monthLabel}`,
    "",
    `Modelo 30 (${monthLabel}):`,
    `• Airbnb (${modelo30.airbnb.taxId}): €${modelo30.airbnb.total.toFixed(2)}`,
    `• Booking.com (${modelo30.booking_com.taxId}): €${modelo30.booking_com.total.toFixed(2)}`,
    "",
    `📎 ${invoicesFilename} attached — guest names + amounts paid, for Portal das Finanças`,
  ];

  if (touristTax) {
    lines.push(`📎 ${touristTax.filename} attached too — Q${touristTax.quarter} ${year} filing`);
  }

  return lines.join("\n");
}
