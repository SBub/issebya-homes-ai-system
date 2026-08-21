-- Remove custom bookings feature — no longer used (admin entry point was removed)
DROP VIEW IF EXISTS public.custom_bookings_public;
DROP TABLE IF EXISTS public.custom_bookings;
