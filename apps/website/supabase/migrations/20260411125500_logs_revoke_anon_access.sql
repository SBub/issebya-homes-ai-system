-- chat_logs and admin_logs are internal server-side tables.
-- Revoke table-level privileges from anon so SELECT throws 42501
-- (RLS alone only silences SELECT — it does not error).
REVOKE ALL ON public.chat_logs FROM anon;
REVOKE ALL ON public.admin_logs FROM anon;
