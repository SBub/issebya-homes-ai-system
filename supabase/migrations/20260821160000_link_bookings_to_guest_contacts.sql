-- Normalizes guest identity out of bookings and into guest_contacts, linked
-- by a foreign key, so the two tables can't drift out of sync the way they
-- could when the webhook wrote guest_name/phone/email/whatsapp_opt_in into
-- both places independently.
--
-- guest_contacts has no email column today (it was only ever populated from
-- WhatsApp/finance-sync sources, see 20260720150002_create_guest_contacts_
-- reconstructed.sql's own comment on that). Every booking always has an
-- email (required at checkout) but, until now, phone was optional — so
-- email is the only guest-identity field guaranteed to exist on every
-- existing bookings row, making it the necessary backfill key. Added with
-- the same nullable-but-unique pattern as phone (20260721090350_add_id_and_
-- guest_name_normalized_to_guest_contacts.sql) — legacy phone-only contacts
-- have no email, so NULLs must be allowed to coexist.
alter table public.guest_contacts
  add column email text;

alter table public.guest_contacts
  add constraint guest_contacts_email_key unique (email);

-- Backfill: one guest_contacts row per distinct email already in bookings
-- that doesn't already have a matching contact. As of this migration every
-- existing bookings row has email but no phone (phone/guest_name were added
-- in the same session, before any real guest had used them), so email is
-- the only usable match key for this one-time backfill.
insert into public.guest_contacts (email)
select distinct b.email
from public.bookings b
where not exists (
  select 1 from public.guest_contacts gc where gc.email = b.email
);

-- Link column, added nullable first so it can be backfilled before the
-- NOT NULL constraint is allowed to apply.
alter table public.bookings
  add column guest_contact_id uuid references public.guest_contacts(id);

update public.bookings b
set guest_contact_id = gc.id
from public.guest_contacts gc
where gc.email = b.email
  and b.guest_contact_id is null;

-- Going forward, phone is a required checkout field (see checkoutSchema),
-- so every new booking's guest_contacts upsert always resolves a real id
-- before the booking row is written — NOT NULL is safe from here on.
alter table public.bookings
  alter column guest_contact_id set not null;

-- Known limitation, not solved here: this backfill matches purely by email,
-- so a guest who already has a phone-only guest_contacts row (e.g. from a
-- past WhatsApp conversation with no booking yet) and books today with a
-- *different* email than any existing record will get a second, separate
-- guest_contacts row rather than being merged into their existing one.
-- Real cross-channel guest de-duplication is a bigger problem than this
-- migration's scope — flagging it rather than silently accepting a subtly
-- wrong merge heuristic.
--
-- guest_name/phone/whatsapp_opt_in/email now live solely on guest_contacts
-- via the FK above — drop the duplicated columns from bookings.
alter table public.bookings
  drop column email,
  drop column phone,
  drop column whatsapp_opt_in,
  drop column guest_name;
