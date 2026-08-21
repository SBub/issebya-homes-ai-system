# Monorepo migration plan

Status: planning only, nothing executed yet.

## Goal

`issebya-homes-ai-system` becomes a Turborepo/yarn-workspaces monorepo. `apps/finance`
gets rebuilt here as a new workspace (not a git-history-preserving move — a fresh
implementation, since it needs to drop its `packages/shared` dependency anyway),
developed and run entirely against the local dev Supabase instance — no production
access. The copy in `issebya-homes-website` keeps running against production
unaffected; decommissioning it is a separate, later decision, out of scope here. Scope
is `apps/finance` only — not `apps/website` or `apps/crm-dashboard`.

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

## Database: local only, no production for now

Explicit decision: we only work against the local dev Supabase instance
(`supabase start`, the same one Orch-A's own `orch_a_runs`/`orch_a_failed_deliveries`
already live in) — no connection to the real production Supabase project at all right
now. `apps/finance` here uses the **same local `DATABASE_URL`** Orch-A already has; no
separate `FINANCE_DATABASE_URL` needed.

Practical consequence: `finance_bookings` doesn't exist locally yet — it needs its own
migration in this repo's `supabase/migrations/`, built with `booked_date` included from
the start (not retrofitted, since we're not touching the production schema at all right
now). Historical CSV backfill (Jan–Jul 2026, per earlier discussion) happens against
this local table via the new upload page, giving real data to develop and test against
without any production access.

Pointing at production at all — and the eventual `issebya-homes-website` decommission —
is a distinct, later decision, not scoped here.

## Parser fixes to apply during the port (not just a straight copy)

Per `docs/finance/plan.md` — these are already-identified bugs/gaps in the original,
being fixed as part of the rewrite rather than ported as-is:

- Airbnb: real guest count (`# of adults + # of children`) instead of hardcoded `2`;
  capture `Booked` date into a new `booked_date` field; derive `gross_room_income` /
  `platform_fee` from the single `Earnings` column via the verified formula, since the
  CSV format in use doesn't have separate fee columns.
- Booking.com: confirm `Original amount` vs `Final amount` against a real CSV row before
  finalizing which maps to `gross_room_income` (flagged, not yet resolved).

## Schema

`finance_bookings` gets created fresh in this repo's local `supabase/migrations/` —
same shape as the original (see `apps/finance` source in `issebya-homes-website` for the
exact columns/enums), plus `booked_date` included from day one (Airbnb's
commission-invoice attribution field — see `modelo-30-filing.md`) rather than bolted on
later, since there's no existing local data or another live consumer to stay compatible
with.

## Migration steps, in order

1. Restructure this repo: create `apps/orch-a/`, `git mv` current root `src/`, `tests/`,
   `scripts/` there; create the workspace-root `package.json` + `turbo.json`; update
   `biome.json`/`knip.json`/`lefthook.yml`/tsconfig paths for the new layout. Verify all
   existing checks (`lint`, `typecheck`, `knip`, `test`) still pass after the reshuffle,
   and that `yarn run:heartbeat`/`yarn preview:digest`/`yarn dev` still work from the new
   location before moving on.
2. Add the `finance_bookings` migration (with `booked_date`) to this repo's
   `supabase/migrations/`.
3. Scaffold `apps/finance/` fresh (Next.js, matching the original's stack) with the 3
   existing endpoints ported (with the parser fixes above) + the 2 new endpoints
   (`modelo30`, `invoices`) + the upload page — all already speced in
   `docs/finance/plan.md`. Points at the same local `DATABASE_URL` as Orch-A.
4. Backfill historical data (Jan–Jul 2026) via the upload page against the local table.
5. Verify `apps/finance` here works correctly — test each endpoint against the real
   backfilled local data — before anything in Orch-A depends on it.
6. Point Orch-A's `src/tools/finance.ts` (and the new Modelo 30 / invoices / tourist-tax
   workflows once built) at this repo's `apps/finance`.

Production cutover and the `issebya-homes-website` decommission are explicitly **not**
part of this plan — deferred to a later, separate decision.

## Open questions, not yet resolved

- Exact turbo.json pipeline shape (task dependency graph) — deferred until apps/finance
  exists and there's a real second workspace to coordinate against.
- When/how production ever gets connected, and what happens to the
  `issebya-homes-website` copy at that point — explicitly deferred, not this plan's
  concern.
