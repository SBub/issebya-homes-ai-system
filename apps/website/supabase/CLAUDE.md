# Supabase — Machine Instructions

## NEVER run `supabase db reset`

Drops entire local DB. Data (knowledge base, outreach) unrecoverable.

CI is the only exception — ephemeral DB, no real data. CI uses psql directly to apply seed instead.

## `supabase start` does not apply seed

CLI v2.x applies migrations only. Seed requires an explicit step:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed.sql
```

CI runs this after `supabase start`. Locally, run it manually if you need a clean seed on top of existing migrations.

## Seed UUID convention

Use realistic v4 UUIDs (`uuidgen`) rather than placeholders like `00000000-0000-0000-0000-000000000001` when writing seed data. This is a style convention, not an enforced rule — nothing in the current codebase validates UUID format on seed data (the Zod `z.string().uuid()` check that used to enforce this lived in the now-deleted `issebya-homes-admin-mcp` function).

## Apply migrations locally

```bash
npx supabase migration up        # apply pending locally — no data loss, local only
npx supabase migration list      # check applied vs pending
```

> `npx supabase migration up` applies to the **local** instance only. To deploy to production use `yarn supabase:migrate` (runs `supabase db push`).

Ghost migration blocking? Repair then retry:

```bash
npx supabase migration repair --status reverted <timestamp>
npx supabase migration up
```

## Schema diff → migration file

```bash
yarn supabase:diff --file supabase/migrations/$(date +%Y%m%d%H%M%S)_<name>.sql
```

## RLS rules

Every table: `ENABLE ROW LEVEL SECURITY`.

**Guest-facing:**

- `booking_availability` (view) — `GRANT SELECT TO anon`. Security barrier view over `bookings`.
- `documents` — `CREATE POLICY "anon read" FOR SELECT TO anon USING (true)`

**Admin-only (all others):** zero policies + `REVOKE ALL ON <table> FROM anon`.

- RLS alone: SELECT returns empty, INSERT raises 42501
- REVOKE: all ops raise 42501 (consistent, testable)
- service_role bypasses RLS regardless — no policies needed for it

**Never create policies without `TO <role>`** — applies to all roles including anon.

## Clients

```ts
createClient(); // anon key — booking_availability + documents only
createAdminClient(); // service role — everything else
```

## Tables

| Table                  | RLS                     | anon        | updated_at trigger | Used by                                   |
| ---------------------- | ----------------------- | ----------- | ------------------ | ----------------------------------------- |
| `bookings`             | on, 0 policies + REVOKE | blocked     | yes                | `apps/website` API routes                 |
| `booking_availability` | view, GRANT SELECT      | SELECT only | —                  | `apps/website`                            |
| `documents`            | on, SELECT policy       | SELECT only | yes                | `issebya-homes-ai-system` (external repo) |
| `channels`             | on, 0 policies + REVOKE | blocked     | yes                | none — manual                             |
| `reference_guides`     | on, 0 policies + REVOKE | blocked     | yes                | none — manual                             |

## Edge functions

| Function  | Path                          | What it does                                                                                 |
| --------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `_shared` | `supabase/functions/_shared/` | Shared helpers, not a deployable function — `openrouter.ts` (embeddings + chat completions). |

## updated_at triggers

Use `clock_timestamp()` not `now()`. `now()` frozen at tx start — trigger fires but value unchanged within same tx.

```sql
CREATE OR REPLACE FUNCTION public.update_<table>_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

CREATE TRIGGER <table>_updated_at
  BEFORE UPDATE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION public.update_<table>_updated_at();
```

Do NOT set `updated_at` manually in app code — trigger handles it.

## Migration rules

- Never edit an applied migration — create a new one
- Never delete migration files — history table tracks them
- One change = one timestamped file
- Squash only when files pile up (rare)

## pgTAP tests

```bash
yarn test:db    # local Supabase must be running
```

Files in `supabase/tests/`. All wrap in `BEGIN/ROLLBACK`.

- Dollar-quote collision: use `$query$ ... $query$` as outer wrapper when `DO $$ ... $$` is inside `lives_ok`
- `plan(N)` must exactly match test call count
- `throws_ok` takes 4 args: query, error code, message, test name

## Seed data

`supabase/seed.sql` includes a static, manually-maintained block for `channels` and `reference_guides` data (marked `[BEGIN MEMORY]` / `[END MEMORY]`). There is no sync tooling — edit the INSERT statements directly and commit `seed.sql`.
