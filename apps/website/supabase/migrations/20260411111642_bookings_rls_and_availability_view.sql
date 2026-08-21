-- Drop incorrect bookings policies (service role bypasses RLS anyway;
-- these were unintentionally granting anon access)
DROP POLICY IF EXISTS "Allow public select" ON "public"."bookings";
DROP POLICY IF EXISTS "Allow service role insert" ON "public"."bookings";
DROP POLICY IF EXISTS "Allow service role update" ON "public"."bookings";

-- Revoke direct table access from anon and authenticated.
-- All booking reads go through booking_availability view.
-- service_role bypasses RLS and retains full access.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.bookings FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.bookings FROM authenticated;

-- Add payment_intent: NULL at checkout creation, populated by Stripe webhook
ALTER TABLE "public"."bookings"
  ADD COLUMN IF NOT EXISTS "payment_intent" text;

-- Safe read-only view for anon: confirmed bookings, safe columns only
CREATE VIEW "public"."booking_availability"
WITH (security_barrier = true) AS
SELECT
  id,
  room_type,
  check_in,
  check_out,
  created_at
FROM "public"."bookings"
WHERE status = 'confirmed';

-- Grant anon SELECT on the view only
GRANT SELECT ON "public"."booking_availability" TO anon;
