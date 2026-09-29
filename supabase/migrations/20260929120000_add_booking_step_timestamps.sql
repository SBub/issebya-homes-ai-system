-- Booking step timestamps: record when each step after payment actually
-- happened, so the website's confirmation page can show them live.
--
--   confirmed_at:        the row became `status = 'confirmed'`. Written by the
--                        Stripe webhook in the same update/insert that sets
--                        the status, and by the website's /api/bookings/direct
--                        route on its recovery and Stripe-fallback paths.
--   guest_email_sent_at: the guest's confirmation email was accepted by
--                        Resend. Written by the webhook after the send.
--   owner_email_sent_at: the owner's notification email was accepted by
--                        Resend. Written by the webhook after the send.
--
-- A failed send leaves its column null; nothing retries it from here.
--
-- RLS and grants are unchanged: the table stays service-role only. The
-- public `booking_availability` view deliberately does not expose these
-- columns. The website reads them through /api/bookings/[token]/events.

alter table public.bookings
  add column confirmed_at timestamptz,
  add column guest_email_sent_at timestamptz,
  add column owner_email_sent_at timestamptz;

-- Backfill rows confirmed before this migration. Those rows went through the
-- same webhook that sends both emails; the timing was simply not recorded.
-- Without this, revisiting an old confirmation link would stream for 90 s and
-- end on the "taking longer than usual" line. `pending` and `cancelled` rows
-- are left alone.
update public.bookings
set
  confirmed_at = updated_at,
  guest_email_sent_at = updated_at,
  owner_email_sent_at = updated_at
where status = 'confirmed'
  and confirmed_at is null;
