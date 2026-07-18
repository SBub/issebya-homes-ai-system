import { parse } from "csv-parse/sync";
import { round2 } from "./round";
import { type FinanceBooking, financeBookingSchema, type Platform, type Room } from "./types";

// Booking.com's "Property name" is an exact per-listing string — same
// lookup table the prior implementation (issebya-homes-website/apps/finance)
// used. Booking.com's CSV format is otherwise unchanged, so this stays as-is.
const BOOKING_COM_LISTING_TO_ROOM: Record<string, Room> = {
  "Private Room 1 near Adraga Beach": "room_1",
  "Private Room 2 near Adraga Beach": "room_2",
  "Private room 1 near Adraga Beach": "room_1",
  "Private room 2 near Adraga Beach": "room_2",
};

const CLEANING_COST = 15.0;

// Airbnb's fixed split-fee formula (3% host commission, 23% VAT on top of
// that commission), verified to the cent against real invoices — see
// docs/finance/modelo-30-filing.md. Time-limited: Airbnb retires this
// split-fee pricing for EU hosts on 2026-10-13; revisit after that date.
const AIRBNB_NET_FACTOR = 0.9631; // 1 - (0.03 * 1.23)

function requireInt(value: string, field: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid value for ${field}: "${value}"`);
  return n;
}

function requireFloat(value: string, field: string): number {
  // Strip currency symbols and whitespace before parsing.
  const n = parseFloat((value ?? "").replace(/[€$£\s]/g, ""));
  if (Number.isNaN(n)) throw new Error(`Invalid value for ${field}: "${value}"`);
  return n;
}

// Accepts ISO (YYYY-MM-DD, optionally with a time component) or US-style
// MM/DD/YYYY — both have been seen in Airbnb/Booking.com CSV exports
// depending on the account's locale settings.
function toIsoDate(value: string, field: string): string {
  const trimmed = (value ?? "").trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  throw new Error(`Invalid date for ${field}: "${value}"`);
}

function nightsBetween(checkinIso: string, checkoutIso: string): number {
  return Math.round(
    (new Date(checkoutIso).getTime() - new Date(checkinIso).getTime()) / 86_400_000,
  );
}

// Airbnb's "Listing" column contains a free-text room identifier (e.g.
// "Private Room 1 near Adraga Beach") — match on the "Room 1"/"Room 2"
// substring rather than an exact lookup, since the surrounding text isn't
// guaranteed stable the way Booking.com's "Property name" is.
function mapAirbnbListingToRoom(listing: string): Room | undefined {
  const lower = (listing ?? "").toLowerCase();
  if (lower.includes("room 1")) return "room_1";
  if (lower.includes("room 2")) return "room_2";
  return undefined;
}

/** Fields shared by both platforms once gross_room_income/platform_fee are known. */
function sharedComputedFields(
  nights: number,
  guests: number,
  grossRoomIncome: number,
  platformFee: number,
  platform: Platform,
) {
  const netReceived = round2(grossRoomIncome - platformFee);
  // Booking.com remits tourist tax directly — only Airbnb bookings owe it here.
  const touristTax = platform === "airbnb" ? 2 * guests * Math.min(nights, 3) : 0;
  const netAfterTourist = platform === "airbnb" ? round2(netReceived - touristTax) : netReceived;
  return {
    net_received: netReceived,
    tourist_tax: touristTax,
    net_after_tourist: netAfterTourist,
    cleaning_cost: CLEANING_COST,
    actual_profit: round2(netAfterTourist - CLEANING_COST),
    irs_taxable_base: round2(netAfterTourist * 0.15),
  };
}

export function detectPlatform(csvText: string): Platform {
  const firstLine = csvText.split("\n")[0] ?? "";
  if (/reservation number/i.test(firstLine)) return "booking_com";
  if (/confirmation code/i.test(firstLine)) return "airbnb";
  throw new Error("Unknown CSV format — not Airbnb or Booking.com reservation statement");
}

/**
 * Parses the "Confirmation code, Status, Guest name, Contact, # of adults,
 * # of children, # of infants, Start date, End date, # of nights, Booked,
 * Listing, Earnings" export. Only a single net `Earnings` figure is
 * available — gross_room_income/platform_fee are derived from it via the
 * verified formula in docs/finance/modelo-30-filing.md.
 */
export function parseAirbnb(csvText: string): FinanceBooking[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return rows.flatMap((row) => {
    // This CSV format has no `Type` column (unlike the old "Earnings"
    // export) to distinguish reservations from other row kinds, so the
    // filtering rule here is a documented, flagged assumption rather than a
    // verified fact: any row whose Status mentions cancellation is treated
    // as not a completed stay; everything else (e.g. "Confirmed") counts.
    // Revisit once a real export with varied Status values is available.
    if (/cancel/i.test(row.Status ?? "")) return [];

    const room = mapAirbnbListingToRoom(row.Listing ?? "");
    if (!room) return [];

    const bookingId = row["Confirmation code"];
    try {
      if (!bookingId) throw new Error("missing Confirmation code");

      const adults = requireInt(row["# of adults"], "# of adults");
      const children = requireInt(row["# of children"], "# of children");
      const guests = adults + children; // infants excluded, per spec

      const nights = requireInt(row["# of nights"], "# of nights");
      const checkinDate = toIsoDate(row["Start date"], "Start date");
      const checkoutDate = toIsoDate(row["End date"], "End date");
      const bookedDate = toIsoDate(row.Booked, "Booked");

      const earnings = requireFloat(row.Earnings, "Earnings");
      const grossRoomIncome = round2(earnings / AIRBNB_NET_FACTOR);
      const platformFee = round2(grossRoomIncome - earnings);

      const booking: FinanceBooking = {
        booking_id: bookingId,
        platform: "airbnb",
        room,
        guest_name: row["Guest name"] ?? "",
        checkin_date: checkinDate,
        checkout_date: checkoutDate,
        booked_date: bookedDate,
        nights,
        guests,
        gross_room_income: grossRoomIncome,
        platform_fee: platformFee,
        status: "completed",
        commission_amount: null,
        ...sharedComputedFields(nights, guests, grossRoomIncome, platformFee, "airbnb"),
      };
      return [financeBookingSchema.parse(booking)];
    } catch (err) {
      throw new Error(
        `Row ${bookingId || "?"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}

/**
 * Parses the "Reservation number, Invoice number, Booked on, Arrival,
 * Departure, Booker name, Guest name, Rooms, Persons, Room nights,
 * Commission %, Original amount, Final amount, Commission amount, Payment
 * fee, Status, Guest request, Currency, Hotel id, Property name, City,
 * Country" export.
 */
export function parseBookingCom(csvText: string): FinanceBooking[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return rows.flatMap((row) => {
    if (row.Status !== "OK") return [];

    const room = BOOKING_COM_LISTING_TO_ROOM[row["Property name"] ?? ""];
    if (!room) return [];

    const reservationNumber = row["Reservation number"];
    try {
      const checkinDate = toIsoDate(row.Arrival, "Arrival");
      const checkoutDate = toIsoDate(row.Departure, "Departure");
      const bookedDate = toIsoDate(row["Booked on"], "Booked on");
      const nights = nightsBetween(checkinDate, checkoutDate);
      const guests = requireInt(row.Persons, "Persons");

      // gross_room_income = Final amount (not Original amount) — flagged,
      // NOT YET verified against a real CSV row (only an invoice PDF has
      // been cross-checked so far). See docs/finance/invoices-filing.md.
      const grossRoomIncome = round2(requireFloat(row["Final amount"], "Final amount"));
      const commissionAmount = round2(requireFloat(row["Commission amount"], "Commission amount"));
      const paymentFee = round2(requireFloat(row["Payment fee"], "Payment fee"));
      const platformFee = round2(commissionAmount + paymentFee);

      const booking: FinanceBooking = {
        booking_id: String(reservationNumber),
        platform: "booking_com",
        room,
        guest_name: row["Guest name"] ?? "",
        checkin_date: checkinDate,
        checkout_date: checkoutDate,
        booked_date: bookedDate,
        nights,
        guests,
        gross_room_income: grossRoomIncome,
        platform_fee: platformFee,
        status: "completed",
        commission_amount: commissionAmount,
        ...sharedComputedFields(nights, guests, grossRoomIncome, platformFee, "booking_com"),
      };
      return [financeBookingSchema.parse(booking)];
    } catch (err) {
      throw new Error(
        `Row ${reservationNumber || "?"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
