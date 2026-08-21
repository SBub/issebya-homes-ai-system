ALTER TABLE public.bookings ADD COLUMN updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.update_bookings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_bookings_updated_at();
