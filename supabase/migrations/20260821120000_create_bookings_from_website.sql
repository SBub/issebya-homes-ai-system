-- Local-dev DB consolidation: apps/website used to run its own separate
-- Supabase project (local project_id 9bfb53c2). For now this repo runs a
-- single local database, so bookings + booking_availability move here,
-- recreated at their current end-state shape (not replayed migration by
-- migration) from apps/website/supabase/migrations/20260409200000_squashed_baseline.sql,
-- 20260411111642_bookings_rls_and_availability_view.sql, and
-- 20260411122701_bookings_updated_at.sql. website's own migrations directory
-- and local project are left in place as historical record, just no longer
-- the runtime target for local dev.
--
-- RLS posture matches website's final state: enabled, zero policies, anon +
-- authenticated explicitly revoked (service_role bypasses RLS regardless).
-- Guest-facing reads go through booking_availability only.
create table public.bookings (
  id                 uuid           primary key default gen_random_uuid(),
  access_token       text           not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  room_type          text           not null check (room_type in ('room1', 'room2')),
  check_in           date           not null,
  check_out          date           not null,
  nights             integer        not null,
  person_count       integer        not null,
  base_price         numeric(10,2)  not null,
  tourist_tax        numeric(10,2)  not null,
  total_amount       numeric(10,2)  not null,
  email              text           not null,
  stripe_session_id  text           not null unique,
  status             text           not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  payment_intent     text,
  created_at         timestamptz    default now(),
  updated_at         timestamptz    default now()
);

alter table public.bookings enable row level security;

revoke select, insert, update, delete on public.bookings from anon;
revoke select, insert, update, delete on public.bookings from authenticated;

create or replace function public.update_bookings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.update_bookings_updated_at();

-- Safe read-only view for anon: confirmed bookings, safe columns only.
create view public.booking_availability
with (security_barrier = true) as
select
  id,
  room_type,
  check_in,
  check_out,
  created_at
from public.bookings
where status = 'confirmed';

grant select on public.booking_availability to anon;
