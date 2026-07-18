import { round2 } from "./round";

// Verified constants — see docs/finance/modelo-30-filing.md and
// docs/finance/invoices-filing.md. Both are tied to Airbnb's current
// split-fee pricing model (3% host commission + 16.8% guest fee), which
// Airbnb is retiring for EU hosts on 2026-10-13. Revisit both after that
// date — see the plan doc's "Known open risks" section.
const AIRBNB_COMMISSION_RATE = 0.03;
const AIRBNB_GUEST_FEE_FACTOR = 1.168;

/**
 * Modelo 30 base value (VAT-excl.) for a single Airbnb booking, derived from
 * the already-stored `gross_room_income` rather than re-parsing the CSV.
 * Rounded per booking (not summed-then-rounded) to match how Airbnb's own
 * invoices round the host service fee per reservation.
 */
export function airbnbBaseCommission(grossRoomIncome: number): number {
  return round2(grossRoomIncome * AIRBNB_COMMISSION_RATE);
}

/**
 * Guest-facing invoice amount for a single Airbnb booking — what the guest
 * paid, not what the host received. See docs/finance/invoices-filing.md.
 */
export function airbnbGuestPaid(grossRoomIncome: number): number {
  return round2(grossRoomIncome * AIRBNB_GUEST_FEE_FACTOR);
}
