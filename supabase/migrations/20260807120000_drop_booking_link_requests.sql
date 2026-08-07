-- booking_link_requests (created by
-- 20260720150000_create_whatsapp_agent_tables.sql) is dropped — the app
-- owner decided sendBookingLink should just build the link (still a stub)
-- with no DB write behind it. Real booking-request tracking will be gated
-- on actual payment instead, not on this tool being called (see
-- apps/guest-communication-agent/src/agent/tools/booking.ts).
drop table public.booking_link_requests;
