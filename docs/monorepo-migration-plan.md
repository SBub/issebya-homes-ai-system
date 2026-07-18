# Monorepo migration plan

Status: planning only, nothing executed yet.

## Goal

`issebya-homes-ai-system` becomes a Turborepo/yarn-workspaces monorepo. `apps/finance`
gets rebuilt here as a new workspace (not a git-history-preserving move — a fresh
implementation, since it needs to drop its `packages/shared` dependency anyway). It
keeps running in `issebya-homes-website` in the meantime; only decommissioned there once
the copy here is verified working. Scope is `apps/finance` only — not `apps/website` or
`apps/crm-dashboard`.

## Target structure

```
issebya-homes-ai-system/
  package.json          # workspace root: workspaces field, shared devDependencies
                         # (biome, knip, lefthook, typescript, vitest), no app-level deps
  turbo.json             # pipeline: dev, build, test, lint, typecheck per workspace
  biome.json              # stays root-level, scans both apps — one config, not per-app
  knip.json               # stays root-level, project globs cover both apps
  lefthook.yml            # stays root-level, hooks run across the whole repo
  tsconfig.base.json       # shared compiler options; each app's tsconfig extends this
  supabase/               # unchanged — Orch-A's own local dev stack (orch_a_runs etc.)
  docs/                   # unchanged
  apps/
    orch-a/               # current root-level src/, tests/, scripts/ move here verbatim
      package.json         # current root package.json content, minus workspace-root-only fields
      src/
      tests/
      scripts/
      tsconfig.json        # extends ../../tsconfig.base.json
    finance/               # new — see below
      package.json
      src/
        app/api/finance/
          import/route.ts
          bookings/route.ts
          tourist-tax/route.ts
          modelo30/route.ts    # new, per docs/finance/plan.md
          invoices/route.ts    # new, per docs/finance/plan.md
        app/upload/page.tsx    # new, per docs/finance/plan.md
        lib/finance/
          parsers.ts            # ported + fixed (see below)
          types.ts
          supabase.ts            # NEW — inlines just the admin-client factory this app
                                  # needs, replacing the packages/shared dependency
      tsconfig.json
```

## Why this drops the `packages/shared` dependency cleanly

`apps/finance` in `issebya-homes-website` only uses `packages/shared` for one thing: a
Supabase admin-client factory (`createAdminClient()`). Scope here is just this one app,
not the whole website monorepo, so there's no reason to port the whole shared package —
inlining that one factory (a few lines: `createClient(url, serviceRoleKey)`) directly
into `apps/finance/src/lib/finance/supabase.ts` removes the cross-repo dependency
entirely, with no loss of functionality.

## A real operational detail: two different databases

Orch-A's own persistence (`orch_a_runs`, `orch_a_failed_deliveries`) currently points at
a **local dev Supabase instance** (`supabase start`, `DATABASE_URL` in `.env`). The
finance data (`finance_bookings`) lives in a **separate, real production Supabase
project** — the same one `issebya-homes-website` uses. These are not the same database
and must not be conflated. `apps/finance` here will need its own env var (e.g.
`FINANCE_DATABASE_URL`, distinct from Orch-A's `DATABASE_URL`) pointing at that
production project, plus its own `FINANCE_API_KEY`, `NOTION_API_KEY`,
`NOTION_DATABASE_ID` — likely the *same* values currently configured for the
`issebya-homes-website` deployment, since this is meant to be the same underlying data,
just served from a new codebase.

This means real production secrets (a service-role key with write access to
`finance_bookings`, containing real guest names/payment data) will exist in this repo's
`.env` once this is wired up. Given the earlier incident this session where real
Telegram credentials briefly ended up in a tracked `.env.example`, worth being
deliberate here: never let real values leave `.env` (gitignored) into any tracked file.

## Parser fixes to apply during the port (not just a straight copy)

Per `docs/finance/plan.md` — these are already-identified bugs/gaps in the original,
being fixed as part of the rewrite rather than ported as-is:
- Airbnb: real guest count (`# of adults + # of children`) instead of hardcoded `2`;
  capture `Booked` date into a new `booked_date` field; derive `gross_room_income` /
  `platform_fee` from the single `Earnings` column via the verified formula, since the
  CSV format in use doesn't have separate fee columns.
- Booking.com: confirm `Original amount` vs `Final amount` against a real CSV row before
  finalizing which maps to `gross_room_income` (flagged, not yet resolved).

## Schema change on the production table

`finance_bookings` needs a new `booked_date` column (Airbnb's commission-invoice
attribution field — see `modelo-30-filing.md`). This is a migration against the **real
production database**, not a local dev one — needs a proper Supabase migration file, and
care around backward compatibility (the old codebase in `issebya-homes-website` will
still be running against this same table during the transition, and doesn't know about
this new column — additive, nullable column, should be safe, but worth confirming
nothing there does a `select *` that would break on an unexpected column, which is
unlikely but cheap to check).

## Migration steps, in order

1. Restructure this repo: create `apps/orch-a/`, `git mv` current root `src/`, `tests/`,
   `scripts/` there; create the workspace-root `package.json` + `turbo.json`; update
   `biome.json`/`knip.json`/`lefthook.yml`/tsconfig paths for the new layout. Verify all
   existing checks (`lint`, `typecheck`, `knip`, `test`) still pass after the reshuffle,
   and that `yarn run:heartbeat`/`yarn preview:digest`/`yarn dev` still work from the new
   location before moving on.
2. Scaffold `apps/finance/` fresh (Next.js, matching the original's stack) with the 3
   existing endpoints ported (with the parser fixes above) + the 2 new endpoints
   (`modelo30`, `invoices`) + the upload page — all already speced in
   `docs/finance/plan.md`.
3. Apply the `booked_date` migration to the production Supabase project.
4. Wire env vars (`FINANCE_DATABASE_URL`, `FINANCE_API_KEY`, `NOTION_API_KEY`,
   `NOTION_DATABASE_ID`) into `apps/finance/.env` here.
5. Verify `apps/finance` here works correctly against real production data — test each
   endpoint, a real CSV import (or a dry run against a copy), before anything in Orch-A
   depends on it.
6. Point Orch-A's `src/tools/finance.ts` (and the new Modelo 30 / invoices / tourist-tax
   workflows once built) at this repo's `apps/finance`, replacing the
   `issebya-homes-website` URL.
7. Decide a deployment target for `apps/finance` from this repo (new Vercel project, or
   reuse somehow) — not yet decided.
8. Only after all of the above is confirmed stable: go back to `issebya-homes-website`
   and remove `apps/finance` there. Separate action, in a separate repo, not part of this
   plan's execution.

## Open questions, not yet resolved

- Deployment target for the new `apps/finance` (step 7).
- Whether local dev needs read access to the real production `finance_bookings` table to
  test against, or whether a safer staging approach (a copy of the data, or careful
  read-only testing) is warranted given it holds real guest PII.
- Exact turbo.json pipeline shape (task dependency graph) — deferred until apps/finance
  exists and there's a real second workspace to coordinate against.
