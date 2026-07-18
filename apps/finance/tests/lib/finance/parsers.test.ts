import { describe, expect, it } from "vitest";
import { detectPlatform, parseAirbnb, parseBookingCom } from "../../../src/lib/finance/parsers.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const AIRBNB_HEADERS =
  "Confirmation code,Status,Guest name,Contact,# of adults,# of children,# of infants,Start date,End date,# of nights,Booked,Listing,Earnings";

function airbnbRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Confirmation code": "HMZDMY8FA9",
    Status: "Confirmed",
    "Guest name": "Ruby Pullum",
    Contact: "",
    "# of adults": "2",
    "# of children": "0",
    "# of infants": "0",
    "Start date": "2026-06-23",
    "End date": "2026-06-26",
    "# of nights": "3",
    Booked: "2026-06-13",
    Listing: "Private Room 2 near Adraga Beach",
    Earnings: "164.54",
    ...overrides,
  };
}

function toAirbnbCsv(rows: Record<string, string>[]): string {
  const keys = AIRBNB_HEADERS.split(",");
  const lines = [AIRBNB_HEADERS, ...rows.map((r) => keys.map((k) => r[k] ?? "").join(","))];
  return lines.join("\n");
}

const BOOKING_COM_HEADERS =
  '"Reservation number","Invoice number","Booked on","Arrival","Departure","Booker name","Guest name","Rooms","Persons","Room nights","Commission %","Original amount","Final amount","Commission amount","Payment fee","Status","Guest request","Currency","Hotel id","Property name","City","Country"';

function bookingComRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Reservation number": "5896495358",
    "Invoice number": "1652565490",
    "Booked on": "2026-02-18T10:02:17",
    Arrival: "2026-04-19",
    Departure: "2026-04-23",
    "Booker name": "MARION TREMINTIN",
    "Guest name": "MARION TREMINTIN",
    Rooms: "1",
    Persons: "2",
    "Room nights": "4",
    "Commission %": "15.00",
    "Original amount": "272.0000",
    "Final amount": "272.0000",
    "Commission amount": "40.8000",
    "Payment fee": "4.03",
    Status: "OK",
    "Guest request": "",
    Currency: "EUR",
    "Hotel id": "15527381",
    "Property name": "Private room 1 near Adraga Beach",
    City: "Almocageme",
    Country: "Portugal",
    ...overrides,
  };
}

function toBookingComCsv(rows: Record<string, string>[]): string {
  const keys = BOOKING_COM_HEADERS.replace(/"/g, "").split(",");
  const lines = [
    BOOKING_COM_HEADERS,
    ...rows.map((r) => keys.map((k) => `"${r[k] ?? ""}"`).join(",")),
  ];
  return lines.join("\n");
}

// ─── detectPlatform ──────────────────────────────────────────────────────────

describe("detectPlatform", () => {
  it("returns airbnb for Airbnb CSV", () => {
    expect(detectPlatform(toAirbnbCsv([airbnbRow()]))).toBe("airbnb");
  });

  it("returns booking_com for Booking.com CSV", () => {
    expect(detectPlatform(toBookingComCsv([bookingComRow()]))).toBe("booking_com");
  });

  it("throws on unknown format", () => {
    expect(() => detectPlatform("col1,col2\nval1,val2")).toThrow("Unknown CSV format");
  });
});

// ─── parseAirbnb — verified fixtures (to the cent) ──────────────────────────
// From docs/finance/modelo-30-filing.md / invoices-filing.md — real Airbnb
// invoices verified against these exact Earnings figures.

describe("parseAirbnb — verified Earnings → gross_room_income/platform_fee fixtures", () => {
  const cases: [earnings: string, roomFee: number, hostFee: number][] = [
    ["105.94", 110.0, 4.06],
    ["193.58", 201.0, 7.42],
    ["258.11", 268.0, 9.89],
    ["415.56", 431.48, 15.92],
  ];

  it.each(cases)("Earnings %s → room_fee %s, host_fee %s", (earnings, roomFee, hostFee) => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow({ Earnings: earnings })]));
    expect(b.gross_room_income).toBeCloseTo(roomFee, 2);
    expect(b.platform_fee).toBeCloseTo(hostFee, 2);
  });
});

describe("parseAirbnb", () => {
  it("parses a reservation row", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow()]));
    expect(b.booking_id).toBe("HMZDMY8FA9");
    expect(b.platform).toBe("airbnb");
    expect(b.room).toBe("room_2");
    expect(b.guest_name).toBe("Ruby Pullum");
    expect(b.checkin_date).toBe("2026-06-23");
    expect(b.checkout_date).toBe("2026-06-26");
    expect(b.booked_date).toBe("2026-06-13");
    expect(b.nights).toBe(3);
  });

  it("sums # of adults + # of children for guests, excluding infants", () => {
    const [b] = parseAirbnb(
      toAirbnbCsv([airbnbRow({ "# of adults": "1", "# of children": "1", "# of infants": "5" })]),
    );
    expect(b.guests).toBe(2);
  });

  it("maps 'Room 1' substring (case-insensitive) to room_1", () => {
    const [b] = parseAirbnb(
      toAirbnbCsv([airbnbRow({ Listing: "private room 1 near Adraga Beach" })]),
    );
    expect(b.room).toBe("room_1");
  });

  it("maps 'Room 2' substring to room_2", () => {
    const [b] = parseAirbnb(
      toAirbnbCsv([airbnbRow({ Listing: "Private Room 2 near Adraga Beach" })]),
    );
    expect(b.room).toBe("room_2");
  });

  it("skips rows with unmapped listing", () => {
    const rows = [airbnbRow({ Listing: "Unknown Villa" }), airbnbRow()];
    expect(parseAirbnb(toAirbnbCsv(rows))).toHaveLength(1);
  });

  it("skips cancelled rows", () => {
    const rows = [airbnbRow({ Status: "Cancelled by guest" }), airbnbRow()];
    expect(parseAirbnb(toAirbnbCsv(rows))).toHaveLength(1);
  });

  it("captures Booked into booked_date", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow({ Booked: "2026-04-26" })]));
    expect(b.booked_date).toBe("2026-04-26");
  });

  it("sets commission_amount to null (Airbnb-only field is booking_com's)", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow()]));
    expect(b.commission_amount).toBeNull();
  });

  it("computes net_received = gross_room_income - platform_fee = Earnings", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow({ Earnings: "193.58" })]));
    expect(b.net_received).toBeCloseTo(193.58, 2);
  });

  it("computes tourist_tax = 2 × guests × min(nights, 3)", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow()])); // 3 nights, 2 guests
    expect(b.tourist_tax).toBe(12);
  });

  it("caps tourist_tax at 3 nights for long stays", () => {
    const [b] = parseAirbnb(
      toAirbnbCsv([airbnbRow({ "# of nights": "7", "End date": "2026-06-30" })]),
    );
    expect(b.tourist_tax).toBe(12);
  });

  it("sets cleaning_cost to 15", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow()]));
    expect(b.cleaning_cost).toBe(15);
  });

  it("sets status to completed", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow()]));
    expect(b.status).toBe("completed");
  });

  it("accepts MM/DD/YYYY dates too", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow({ "Start date": "6/23/2026" })]));
    expect(b.checkin_date).toBe("2026-06-23");
  });

  it("throws when # of nights is empty", () => {
    expect(() => parseAirbnb(toAirbnbCsv([airbnbRow({ "# of nights": "" })]))).toThrow(
      "# of nights",
    );
  });

  it("throws when Earnings is empty", () => {
    expect(() => parseAirbnb(toAirbnbCsv([airbnbRow({ Earnings: "" })]))).toThrow("Earnings");
  });

  it("strips currency symbol from Earnings", () => {
    const [b] = parseAirbnb(toAirbnbCsv([airbnbRow({ Earnings: "€105.94" })]));
    expect(b.gross_room_income).toBeCloseTo(110.0, 2);
  });
});

// ─── parseBookingCom ─────────────────────────────────────────────────────────

describe("parseBookingCom", () => {
  it("parses a reservation row", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.booking_id).toBe("5896495358");
    expect(b.platform).toBe("booking_com");
    expect(b.room).toBe("room_1");
    expect(b.guest_name).toBe("MARION TREMINTIN");
    expect(b.checkin_date).toBe("2026-04-19");
    expect(b.checkout_date).toBe("2026-04-23");
    expect(b.booked_date).toBe("2026-02-18");
    expect(b.nights).toBe(4);
    expect(b.guests).toBe(2);
  });

  it("skips rows where Status is not OK", () => {
    const rows = [bookingComRow({ Status: "cancelled" }), bookingComRow()];
    expect(parseBookingCom(toBookingComCsv(rows))).toHaveLength(1);
  });

  it("skips rows with unknown property name", () => {
    const rows = [bookingComRow({ "Property name": "Unknown Hotel" }), bookingComRow()];
    expect(parseBookingCom(toBookingComCsv(rows))).toHaveLength(1);
  });

  it("uses Final amount (not Original amount) for gross_room_income", () => {
    const [b] = parseBookingCom(
      toBookingComCsv([
        bookingComRow({ "Original amount": "300.0000", "Final amount": "272.0000" }),
      ]),
    );
    expect(b.gross_room_income).toBeCloseTo(272.0, 2);
  });

  it("stores commission_amount separately from the combined platform_fee", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.commission_amount).toBeCloseTo(40.8, 2);
    expect(b.platform_fee).toBeCloseTo(44.83, 2); // 40.80 + 4.03
  });

  it("computes net_received = gross_room_income - platform_fee", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.net_received).toBeCloseTo(227.17, 2); // 272.00 - 44.83
  });

  it("sets tourist_tax to 0 (Booking.com remits directly)", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.tourist_tax).toBe(0);
  });

  it("sets net_after_tourist = net_received", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.net_after_tourist).toBeCloseTo(b.net_received, 2);
  });

  it("computes actual_profit = net_after_tourist - cleaning_cost", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.actual_profit).toBeCloseTo(212.17, 2); // 227.17 - 15
  });

  it("computes irs_taxable_base = net_after_tourist × 0.15", () => {
    const [b] = parseBookingCom(toBookingComCsv([bookingComRow()]));
    expect(b.irs_taxable_base).toBeCloseTo(34.08, 2); // 227.17 * 0.15
  });

  it("throws when Persons is empty", () => {
    expect(() => parseBookingCom(toBookingComCsv([bookingComRow({ Persons: "" })]))).toThrow(
      "Persons",
    );
  });

  it("throws when Final amount is empty", () => {
    expect(() => parseBookingCom(toBookingComCsv([bookingComRow({ "Final amount": "" })]))).toThrow(
      "Final amount",
    );
  });
});
