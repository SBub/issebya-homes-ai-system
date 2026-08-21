BEGIN;

SELECT plan(14);

-- ============================================================
-- Schema
-- ============================================================

SELECT has_table('public', 'reference_guides', 'reference_guides table exists');

SELECT has_column('public', 'reference_guides', 'id', 'has id');
SELECT has_column('public', 'reference_guides', 'type', 'has type');
SELECT has_column('public', 'reference_guides', 'scope', 'has scope');
SELECT has_column('public', 'reference_guides', 'summary', 'has summary');
SELECT has_column('public', 'reference_guides', 'examples', 'has examples');
SELECT has_column('public', 'reference_guides', 'logs', 'has logs');
SELECT has_column('public', 'reference_guides', 'channel_ids', 'has channel_ids');
SELECT has_column('public', 'reference_guides', 'created_at', 'has created_at');
SELECT has_column('public', 'reference_guides', 'updated_at', 'has updated_at');

-- ============================================================
-- Constraints
-- ============================================================

SELECT throws_ok(
  $$INSERT INTO public.reference_guides (type, channel_ids)
    VALUES ('email', '{}')$$,
  '23514',
  NULL,
  'type rejects invalid value'
);

-- ============================================================
-- updated_at trigger
-- ============================================================

SELECT lives_ok(
  $query$
  DO $$
  DECLARE
    g_id uuid;
    t1 timestamptz;
    t2 timestamptz;
  BEGIN
    INSERT INTO public.reference_guides (type, channel_ids)
    VALUES ('copy', '{}')
    RETURNING id INTO g_id;

    SELECT updated_at INTO t1 FROM public.reference_guides WHERE id = g_id;

    PERFORM pg_sleep(0.01);

    UPDATE public.reference_guides SET summary = 'updated' WHERE id = g_id;

    SELECT updated_at INTO t2 FROM public.reference_guides WHERE id = g_id;

    IF t2 <= t1 THEN
      RAISE EXCEPTION 'updated_at did not change after UPDATE';
    END IF;
  END;
  $$ LANGUAGE plpgsql
  $query$,
  'updated_at trigger fires on UPDATE'
);

-- ============================================================
-- RLS
-- ============================================================

SET LOCAL ROLE anon;

SELECT throws_ok(
  'SELECT * FROM public.reference_guides LIMIT 1',
  '42501',
  NULL,
  'anon cannot SELECT from reference_guides'
);

SELECT throws_ok(
  $$INSERT INTO public.reference_guides (type, channel_ids)
    VALUES ('copy', '{}')$$,
  '42501',
  NULL,
  'anon cannot INSERT into reference_guides'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
