import { describe, expect, it } from "vitest";
import { airbnbBaseCommission, airbnbGuestPaid } from "@/lib/finance/formulas.js";

// Verified fixtures from docs/finance/modelo-30-filing.md and
// docs/finance/invoices-filing.md — real Airbnb room_fee (= gross_room_income)
// values checked against actual invoices/"Guest paid" figures.

describe("airbnbBaseCommission (Modelo 30 base value, VAT-excl.)", () => {
  const cases: [roomFee: number, baseCommission: number][] = [
    [110.0, 3.3],
    [201.0, 6.03],
    [268.0, 8.04],
    [431.48, 12.94],
  ];

  it.each(cases)("room_fee %s → base_commission %s", (roomFee, baseCommission) => {
    expect(airbnbBaseCommission(roomFee)).toBeCloseTo(baseCommission, 2);
  });
});

describe("airbnbGuestPaid (guest-facing invoice amount)", () => {
  const cases: [roomFee: number, guestPaid: number][] = [
    [110.0, 128.48],
    [201.0, 234.77],
    [268.0, 313.02],
    [431.48, 503.97],
  ];

  it.each(cases)("room_fee %s → guest_paid %s", (roomFee, guestPaid) => {
    expect(airbnbGuestPaid(roomFee)).toBeCloseTo(guestPaid, 2);
  });
});
