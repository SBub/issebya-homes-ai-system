-- guest_contacts is now populated from apps/finance's finance_bookings
-- history (see apps/guest-communication-agent/src/lib/finance-sync.ts), which
-- has no phone numbers at all — phone gets filled in manually later, once a
-- human recognizes a guest from their WhatsApp number. That means a
-- guest_contacts row must be able to exist with phone = NULL, which is
-- incompatible with `phone text PRIMARY KEY` from the previous migration
-- (20260720150002_create_guest_contacts_reconstructed.sql). This migration:
--   1. Drops the old phone-as-PK constraint.
--   2. Adds a surrogate `id uuid` primary key instead.
--   3. Makes `phone` nullable, but keeps it UNIQUE (Postgres unique
--      constraints already treat multiple NULLs as non-conflicting, so many
--      phone-less rows can coexist without any special-casing).
--
-- Separately, the finance sync needs a stable "does a guest_contacts row
-- already exist for this guest" key to upsert against, and guest_name alone
-- is not safe for that: the real local finance_bookings data already
-- contains both "Marion Tremintin" and "MARION TREMINTIN" as distinct rows
-- (same room_1, nearby July/August 2026 checkin dates) that are
-- near-certainly the same person, differing only in casing. A naive
-- `GROUP BY guest_name` (or a unique constraint on the raw column) would
-- create two separate guest_contacts rows for one real guest.
--
-- `guest_name_normalized` (guest_name.trim().toLowerCase(), computed in
-- application code, not a generated column) exists to make that matching
-- case/whitespace-insensitive. It is intentionally a plain nullable text
-- column with a plain UNIQUE constraint on it, NOT a functional/expression
-- unique index on `lower(trim(guest_name))` — Supabase-JS's upsert
-- `onConflict` option expects a plain column or constraint name, and
-- reliably referencing an expression index through it is awkward/unsupported
-- in practice. The sync logic instead does an explicit `select ... eq
-- guest_name_normalized` lookup followed by an update-or-insert, using this
-- column for plain equality rather than relying on a DB-level
-- ON CONFLICT/upsert against an expression.

alter table public.guest_contacts
  drop constraint guest_contacts_pkey;

alter table public.guest_contacts
  add column id uuid not null default gen_random_uuid();

alter table public.guest_contacts
  add constraint guest_contacts_pkey primary key (id);

alter table public.guest_contacts
  alter column phone drop not null;

alter table public.guest_contacts
  add constraint guest_contacts_phone_key unique (phone);

alter table public.guest_contacts
  add column guest_name_normalized text;

alter table public.guest_contacts
  add constraint guest_contacts_guest_name_normalized_key unique (guest_name_normalized);
