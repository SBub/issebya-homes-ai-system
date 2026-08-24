-- Booking/GCA interop: capture the guest's WhatsApp number + opt-in at
-- checkout, and where the booking originated (a direct website visit vs a
-- GCA-issued sendBookingLink). phone is optional — direct visitors are never
-- required to give one. whatsapp_opt_in is pure marketing/campaign consent
-- (maps to guest_contacts.enabled) — it does not gate the transactional
-- WhatsApp confirmation ping. That ping is sent by the Stripe webhook only
-- when source='gca': the guest already has an open WhatsApp thread with the
-- business (they messaged first), so a courtesy confirmation there isn't
-- marketing and needs no separate opt-in.
alter table public.bookings
  add column phone text,
  add column whatsapp_opt_in boolean not null default false,
  add column source text not null default 'direct' check (source in ('direct', 'gca'));
