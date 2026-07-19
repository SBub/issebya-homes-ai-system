import { describe, expect, it } from "vitest";
import {
  buildImportMessage,
  distinctModelo30Months,
  formatMonthYear,
  invoicesToCsv,
  isQuarterClosingMonth,
  monthRange,
  monthToQuarter,
} from "../../../src/lib/finance/reports.js";
import type { FinanceBooking } from "../../../src/lib/finance/types.js";

// Minimal valid FinanceBooking fixture — only the fields exercised by the
// month/quarter detection logic vary per test; the rest are filler.
function booking(overrides: Partial<FinanceBooking>): FinanceBooking {
  return {
    booking_id: "ID1",
    platform: "airbnb",
    room: "room_1",
    guest_name: "Guest",
    checkin_date: "2026-07-01",
    checkout_date: "2026-07-03",
    booked_date: "2026-06-15",
    nights: 2,
    guests: 2,
    gross_room_income: 100,
    platform_fee: 10,
    net_received: 90,
    tourist_tax: 8,
    net_after_tourist: 82,
    cleaning_cost: 15,
    actual_profit: 67,
    irs_taxable_base: 12.3,
    status: "completed",
    commission_amount: null,
    ...overrides,
  };
}

describe("distinctModelo30Months", () => {
  it("uses booked_date for airbnb bookings", () => {
    const bookings = [booking({ platform: "airbnb", booked_date: "2026-08-01" })];
    expect(distinctModelo30Months(bookings)).toEqual([{ year: 2026, month: 8 }]);
  });

  it("uses checkout_date for booking_com bookings", () => {
    const bookings = [
      booking({
        platform: "booking_com",
        booked_date: "2026-06-01",
        checkout_date: "2026-09-13",
        commission_amount: 12,
      }),
    ];
    expect(distinctModelo30Months(bookings)).toEqual([{ year: 2026, month: 9 }]);
  });

  it("dedupes and sorts multiple bookings across months", () => {
    const bookings = [
      booking({ platform: "airbnb", booked_date: "2026-08-10" }),
      booking({ platform: "airbnb", booked_date: "2026-08-03" }), // same month, dupe
      booking({
        platform: "booking_com",
        checkout_date: "2026-09-19",
        commission_amount: 5,
      }),
      booking({ platform: "airbnb", booked_date: "2026-07-01" }),
    ];
    expect(distinctModelo30Months(bookings)).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  it("skips bookings with a null attribution date", () => {
    const bookings = [booking({ platform: "airbnb", booked_date: null })];
    expect(distinctModelo30Months(bookings)).toEqual([]);
  });

  it("returns an empty array for an empty batch", () => {
    expect(distinctModelo30Months([])).toEqual([]);
  });
});

describe("monthToQuarter", () => {
  const cases: [month: number, quarter: number][] = [
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [6, 2],
    [7, 3],
    [8, 3],
    [9, 3],
    [10, 4],
    [11, 4],
    [12, 4],
  ];
  it.each(cases)("month %s → quarter %s", (month, quarter) => {
    expect(monthToQuarter(month)).toBe(quarter);
  });
});

describe("isQuarterClosingMonth", () => {
  it("is true for March, June, September, December", () => {
    expect(isQuarterClosingMonth(3)).toBe(true);
    expect(isQuarterClosingMonth(6)).toBe(true);
    expect(isQuarterClosingMonth(9)).toBe(true);
    expect(isQuarterClosingMonth(12)).toBe(true);
  });

  it("is false for every other month", () => {
    for (const month of [1, 2, 4, 5, 7, 8, 10, 11]) {
      expect(isQuarterClosingMonth(month)).toBe(false);
    }
  });
});

describe("monthRange", () => {
  it("returns the first and last calendar day of the month", () => {
    expect(monthRange(2026, 7)).toEqual(["2026-07-01", "2026-07-31"]);
    expect(monthRange(2026, 2)).toEqual(["2026-02-01", "2026-02-28"]); // not a leap year
    expect(monthRange(2028, 2)).toEqual(["2028-02-01", "2028-02-29"]); // leap year
  });
});

describe("formatMonthYear", () => {
  it("formats as 'Month Year'", () => {
    expect(formatMonthYear(2026, 7)).toBe("July 2026");
    expect(formatMonthYear(2026, 1)).toBe("January 2026");
    expect(formatMonthYear(2026, 12)).toBe("December 2026");
  });
});

describe("invoicesToCsv", () => {
  it("builds a CSV with a header row and one line per reservation", () => {
    const csv = invoicesToCsv([
      {
        guest_name: "Jane Doe",
        checkin_date: "2026-07-05",
        checkout_date: "2026-07-08",
        room: "room_1",
        guest_paid: 128.48,
      },
      {
        guest_name: "Mark Silva",
        checkin_date: "2026-07-12",
        checkout_date: "2026-07-16",
        room: "room_2",
        guest_paid: 258.11,
      },
    ]);
    expect(csv).toBe(
      [
        "Guest name,Check-in,Check-out,Room,Amount paid",
        "Jane Doe,2026-07-05,2026-07-08,Room 1,128.48",
        "Mark Silva,2026-07-12,2026-07-16,Room 2,258.11",
      ].join("\n"),
    );
  });

  it("emits just the header row for no reservations", () => {
    expect(invoicesToCsv([])).toBe("Guest name,Check-in,Check-out,Room,Amount paid");
  });
});

describe("buildImportMessage", () => {
  const modelo30 = {
    airbnb: { total: 17.37, count: 3, taxId: "IE9827384L" },
    booking_com: { total: 67.8, count: 2, taxId: "NL805734958B01" },
  };

  it("matches the specified message format for a non-quarter-closing month", () => {
    const text = buildImportMessage({
      year: 2026,
      month: 7,
      modelo30,
      invoicesFilename: "invoices-2026-07.csv",
    });
    expect(text).toBe(
      [
        "📋 Import complete for July 2026",
        "",
        "Modelo 30 (July 2026):",
        "• Airbnb (IE9827384L): €17.37",
        "• Booking.com (NL805734958B01): €67.80",
        "",
        "📎 invoices-2026-07.csv attached — guest names + amounts paid, for Portal das Finanças",
      ].join("\n"),
    );
  });

  it("appends a tourist-tax attachment line on quarter-closing months", () => {
    const text = buildImportMessage({
      year: 2026,
      month: 9,
      modelo30,
      invoicesFilename: "invoices-2026-09.csv",
      touristTax: { quarter: 3, filename: "tourist-tax-Q3-2026.csv" },
    });
    expect(text).toContain(
      "📎 invoices-2026-09.csv attached — guest names + amounts paid, for Portal das Finanças",
    );
    expect(text).toContain("📎 tourist-tax-Q3-2026.csv attached too — Q3 2026 filing");
  });

  it("still shows €0.00 for a platform with zero bookings rather than hiding it", () => {
    const text = buildImportMessage({
      year: 2026,
      month: 7,
      modelo30: {
        airbnb: { total: 0, count: 0, taxId: "IE9827384L" },
        booking_com: { total: 67.8, count: 2, taxId: "NL805734958B01" },
      },
      invoicesFilename: "invoices-2026-07.csv",
    });
    expect(text).toContain("• Airbnb (IE9827384L): €0.00");
  });
});
