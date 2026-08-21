CREATE OR REPLACE FUNCTION public.update_reference_guides_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

CREATE TRIGGER reference_guides_updated_at
  BEFORE UPDATE ON public.reference_guides
  FOR EACH ROW EXECUTE FUNCTION public.update_reference_guides_updated_at();
