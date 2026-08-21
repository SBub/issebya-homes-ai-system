-- channels: add updated_at + trigger
ALTER TABLE public.channels ADD COLUMN updated_at timestamptz DEFAULT now() NOT NULL;

CREATE OR REPLACE FUNCTION public.update_channels_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

CREATE TRIGGER channels_updated_at
  BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.update_channels_updated_at();

-- Revoke table-level access from anon so all operations raise 42501
-- (RLS alone only blocks INSERT; SELECT/UPDATE/DELETE silently return empty)
REVOKE ALL ON public.channels FROM anon;

-- Drop bad admin-only table policies (no TO clause = anon access, wrong)
DROP POLICY IF EXISTS "Service role full access" ON public.channels;
DROP POLICY IF EXISTS "Service role full access" ON public.outreach_history;
DROP POLICY IF EXISTS "Service role full access" ON public.reference_guides;
DROP POLICY IF EXISTS "Service role write" ON public.knowledge_gap_topics;
DROP POLICY IF EXISTS "Authenticated read" ON public.knowledge_gap_topics;
DROP POLICY IF EXISTS "Service role insert" ON public.processed_sessions;
DROP POLICY IF EXISTS "Authenticated read" ON public.processed_sessions;
