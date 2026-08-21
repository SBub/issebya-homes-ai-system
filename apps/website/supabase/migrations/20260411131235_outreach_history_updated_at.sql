ALTER TABLE public.outreach_history ADD COLUMN updated_at timestamptz DEFAULT now() NOT NULL;

CREATE OR REPLACE FUNCTION public.update_outreach_history_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

CREATE TRIGGER outreach_history_updated_at
  BEFORE UPDATE ON public.outreach_history
  FOR EACH ROW EXECUTE FUNCTION public.update_outreach_history_updated_at();
