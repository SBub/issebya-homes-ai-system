-- reference_guides: add updated_at trigger (column already exists from baseline)
CREATE OR REPLACE FUNCTION public.update_reference_guides_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS reference_guides_updated_at ON public.reference_guides;
CREATE TRIGGER reference_guides_updated_at
  BEFORE UPDATE ON public.reference_guides
  FOR EACH ROW EXECUTE FUNCTION public.update_reference_guides_updated_at();

-- Revoke table-level access from anon on admin-only tables
-- (RLS alone only blocks INSERT; SELECT returns empty without error)
REVOKE ALL ON public.reference_guides FROM anon;
REVOKE ALL ON public.knowledge_gap_topics FROM anon;
REVOKE ALL ON public.processed_sessions FROM anon;
