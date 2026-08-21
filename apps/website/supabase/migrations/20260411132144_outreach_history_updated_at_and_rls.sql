-- Revoke table-level access from anon so all operations raise 42501
-- (RLS alone only blocks INSERT; SELECT silently returns empty)
REVOKE ALL ON public.outreach_history FROM anon;
