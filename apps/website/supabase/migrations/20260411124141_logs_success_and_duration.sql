-- chat_logs: add success, drop channel
ALTER TABLE public.chat_logs ADD COLUMN success boolean NOT NULL DEFAULT true;
ALTER TABLE public.chat_logs DROP COLUMN channel;

-- admin_logs: add success + latency_ms
ALTER TABLE public.admin_logs ADD COLUMN success boolean NOT NULL DEFAULT true;
ALTER TABLE public.admin_logs ADD COLUMN latency_ms integer;

-- Drop bad chat_logs policies
DROP POLICY IF EXISTS "Service role insert" ON public.chat_logs;
DROP POLICY IF EXISTS "Authenticated read" ON public.chat_logs;

-- Drop redundant admin_logs policy (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role full access" ON public.admin_logs;
