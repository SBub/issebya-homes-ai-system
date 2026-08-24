-- Capture the guest's name at checkout, alongside phone. A sendBookingLink
-- already requires guestName as a tool input (to compose the owner-facing
-- approval nudge text) but this was never threaded into the generated URL
-- until now, so the website had no way to prefill it. Nullable/optional —
-- same reasoning as phone: direct website visitors are never required to
-- give one, and no backfill for existing rows.
alter table public.bookings
  add column guest_name text;
