BEGIN;

SELECT plan(13);

-- ============================================================
-- Schema
-- ============================================================

SELECT has_table('public', 'channels', 'channels table exists');

SELECT has_column('public', 'channels', 'id', 'has id');
SELECT has_column('public', 'channels', 'platform', 'has platform');
SELECT has_column('public', 'channels', 'name', 'has name');
SELECT has_column('public', 'channels', 'description', 'has description');
SELECT has_column('public', 'channels', 'active', 'has active');
SELECT has_column('public', 'channels', 'updated_at', 'has updated_at');

-- platform constraint
SELECT throws_ok(
  $$INSERT INTO public.channels (platform, name, description)
    VALUES ('tiktok', 'TikTok', 'test')$$,
  '23514',
  NULL,
  'platform rejects invalid value'
);

-- updated_at auto-updates on row change
SELECT lives_ok(
  $query$
  DO $$
  DECLARE
    ch_id uuid;
    t1 timestamptz;
    t2 timestamptz;
  BEGIN
    INSERT INTO public.channels (platform, name, description)
    VALUES ('instagram', 'Test', 'test')
    RETURNING id INTO ch_id;

    SELECT updated_at INTO t1 FROM public.channels WHERE id = ch_id;

    PERFORM pg_sleep(0.01);

    UPDATE public.channels SET name = 'Updated' WHERE id = ch_id;

    SELECT updated_at INTO t2 FROM public.channels WHERE id = ch_id;

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
  'SELECT * FROM public.channels LIMIT 1',
  '42501',
  NULL,
  'anon cannot SELECT from channels'
);

SELECT throws_ok(
  $$INSERT INTO public.channels (platform, name, description)
    VALUES ('instagram', 'Hack', 'test')$$,
  '42501',
  NULL,
  'anon cannot INSERT into channels'
);

SELECT throws_ok(
  $$UPDATE public.channels SET name = 'Hack'$$,
  '42501',
  NULL,
  'anon cannot UPDATE channels'
);

SELECT throws_ok(
  'DELETE FROM public.channels',
  '42501',
  NULL,
  'anon cannot DELETE from channels'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
