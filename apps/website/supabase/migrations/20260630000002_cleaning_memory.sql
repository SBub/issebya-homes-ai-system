-- cleaning_memory: unified style memory, single row, updated after every edit
CREATE TABLE public.cleaning_memory (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton  boolean     NOT NULL DEFAULT true UNIQUE CHECK (singleton = true),
  rules      text        NOT NULL DEFAULT '',
  examples   jsonb       NOT NULL DEFAULT '[]',
  edit_count int         NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cleaning_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cleaning_memory FROM anon;
