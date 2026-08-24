BEGIN;

SELECT plan(19);

-- ============================================================
-- Schema
-- ============================================================

SELECT has_table('public', 'bookings', 'bookings table exists');

SELECT has_view('public', 'booking_availability', 'booking_availability view exists');

-- Column types
SELECT col_type_is('public', 'bookings', 'id', 'uuid', 'id is uuid');
SELECT col_type_is('public', 'bookings', 'check_in', 'date', 'check_in is date');
SELECT col_type_is('public', 'bookings', 'check_out', 'date', 'check_out is date');
SELECT col_type_is('public', 'bookings', 'status', 'text', 'status is text');

-- NOT NULL constraints
SELECT col_not_null('public', 'bookings', 'room_type', 'room_type is NOT NULL');
SELECT col_not_null('public', 'bookings', 'email', 'email is NOT NULL');
SELECT col_not_null('public', 'bookings', 'stripe_session_id', 'stripe_session_id is NOT NULL');

-- payment_intent: exists and nullable (NULL at checkout, set by webhook)
SELECT has_column('public', 'bookings', 'payment_intent', 'payment_intent column exists');
SELECT col_is_null('public', 'bookings', 'payment_intent', 'payment_intent is nullable (set by webhook)');

-- Check constraints enforced
SELECT throws_ok(
  $$INSERT INTO public.bookings
      (room_type, check_in, check_out, nights, person_count, base_price,
       tourist_tax, total_amount, email, stripe_session_id, status)
    VALUES
      ('room3', '2026-05-01', '2026-05-03', 2, 2, 100, 5, 105,
       'test@example.com', 'sess_invalid_room', 'confirmed')$$,
  '23514',
  NULL,
  'room_type rejects invalid value'
);

SELECT throws_ok(
  $$INSERT INTO public.bookings
      (room_type, check_in, check_out, nights, person_count, base_price,
       tourist_tax, total_amount, email, stripe_session_id, status)
    VALUES
      ('room1', '2026-05-01', '2026-05-03', 2, 2, 100, 5, 105,
       'test@example.com', 'sess_invalid_status', 'unknown_status')$$,
  '23514',
  NULL,
  'status rejects invalid value'
);

-- ============================================================
-- RLS — anon cannot access bookings table directly
-- ============================================================

-- Insert test data as superuser before switching roles
INSERT INTO public.bookings
  (room_type, check_in, check_out, nights, person_count, base_price,
   tourist_tax, total_amount, email, stripe_session_id, status)
VALUES
  ('room1', '2027-06-01', '2027-06-03', 2, 2, 200.00, 10.00, 210.00,
   'guest@example.com', 'sess_confirmed_001', 'confirmed'),
  ('room2', '2027-06-10', '2027-06-12', 2, 1, 150.00, 7.50, 157.50,
   'guest2@example.com', 'sess_pending_001', 'pending');

SET LOCAL ROLE anon;

SELECT throws_ok(
  'SELECT * FROM public.bookings LIMIT 1',
  '42501',
  NULL,
  'anon cannot SELECT from bookings table'
);

SELECT throws_ok(
  $$INSERT INTO public.bookings
      (room_type, check_in, check_out, nights, person_count, base_price,
       tourist_tax, total_amount, email, stripe_session_id, status)
    VALUES
      ('room1', '2026-07-01', '2026-07-03', 2, 2, 100, 5, 105,
       'attacker@example.com', 'sess_attacker', 'confirmed')$$,
  '42501',
  NULL,
  'anon cannot INSERT into bookings table'
);

RESET ROLE;

-- ============================================================
-- booking_availability view — anon access + data rules
-- ============================================================

SET LOCAL ROLE anon;

SELECT lives_ok(
  'SELECT * FROM public.booking_availability',
  'anon can SELECT from booking_availability view'
);

-- View only exposes confirmed bookings (filter to test-inserted rows by date range)
SELECT is(
  (SELECT count(*)::int FROM public.booking_availability
   WHERE check_in BETWEEN '2027-06-01' AND '2027-06-12'),
  1,
  'view returns only confirmed bookings (not pending)'
);

-- View does not expose sensitive columns
SELECT throws_ok(
  'SELECT access_token FROM public.booking_availability',
  '42703',
  NULL,
  'view does not expose access_token column'
);

SELECT throws_ok(
  'SELECT stripe_session_id FROM public.booking_availability',
  '42703',
  NULL,
  'view does not expose stripe_session_id column'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
