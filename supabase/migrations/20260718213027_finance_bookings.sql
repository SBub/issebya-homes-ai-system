-- Local rebuild of finance_bookings for apps/finance (docs/monorepo-migration-plan.md).
-- Same shape as the original in issebya-homes-website's apps/finance, plus
-- booked_date from day one (Airbnb's commission-invoice attribution date — see
-- docs/finance/modelo-30-filing.md) rather than retrofitted later, since there's
-- no existing local data or another live consumer to stay compatible with.
--
-- Local dev only — this is not a copy of production data, see
-- docs/monorepo-migration-plan.md's "Database: local only" section.

create type finance_platform as enum ('airbnb', 'booking_com', 'direct');
create type finance_room as enum ('room_1', 'room_2');
create type finance_booking_status as enum ('completed');

create table if not exists finance_bookings (
  booking_id text primary key,
  platform finance_platform not null,
  room finance_room not null,
  guest_name text not null,
  checkin_date date not null,
  checkout_date date not null,
  booked_date date,
  nights integer not null,
  guests integer not null,
  gross_room_income numeric(10, 2) not null,
  platform_fee numeric(10, 2) not null,
  net_received numeric(10, 2) not null,
  tourist_tax numeric(10, 2) not null,
  net_after_tourist numeric(10, 2) not null,
  cleaning_cost numeric(10, 2) not null,
  actual_profit numeric(10, 2) not null,
  irs_taxable_base numeric(10, 2) not null,
  status finance_booking_status not null default 'completed',
  acquisition_channel text
);

-- Matches production's lockdown: RLS enabled, no policies — only a service-role
-- (or, locally, a direct Postgres connection as the postgres role) can read/write.
alter table finance_bookings enable row level security;

-- Query patterns already known from docs/finance/plan.md: tourist tax filters by
-- checkin_date + platform; Modelo 30 filters by booked_date (Airbnb) or
-- checkout_date (Booking.com).
create index if not exists finance_bookings_checkin_date_idx on finance_bookings (checkin_date);
create index if not exists finance_bookings_checkout_date_idx on finance_bookings (checkout_date);
create index if not exists finance_bookings_booked_date_idx on finance_bookings (booked_date);
create index if not exists finance_bookings_platform_idx on finance_bookings (platform);
