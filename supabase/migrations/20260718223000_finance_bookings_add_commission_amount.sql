-- Additive follow-up to 20260718213027_finance_bookings.sql (apps/finance
-- scaffold, docs/monorepo-migration-plan.md / docs/finance/plan.md).
--
-- Modelo 30 needs Booking.com's *pure* commission amount (VAT-excl. base
-- value, no payment-processing fee mixed in) — see
-- docs/finance/modelo-30-filing.md. `platform_fee` on this table is the
-- combined `commission + payment fee` used for the host's own P&L math
-- (net_received etc.), so it can't be un-mixed after the fact without
-- storing the raw commission separately. This column is nullable and only
-- populated for `booking_com` rows; Airbnb's Modelo 30 base is instead
-- derived from the already-stored `gross_room_income` (× 0.03), so Airbnb
-- rows leave this null.
alter table finance_bookings
  add column if not exists commission_amount numeric(10, 2);
