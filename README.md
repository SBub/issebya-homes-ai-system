# issebya-homes-ai-system — Orch-A

Orchestrator agent for the issebya.homes automation system. See `docs/spec-v0.1.0.md`
for the full spec and `docs/agent-architecture.mmd` for the target-state org chart.

v0.1.0 scope: scheduled heartbeat that reads Availability + Finance state, runs
three health checks, and reports a digest to Telegram. Read-only, no delegate
agents wired yet.

Built with [Mastra](https://mastra.ai) (`Agent` + typed tools + `Workflow`), TypeScript.

> **Note:** `src/tools/availability.ts` fetches real data — `GET
> issebya.com/api/availability?room=room1|room2` — for the 2 rooms currently live.
> `src/tools/finance.ts` still returns fixed stub data instead of querying
> Postgres; swap it for a real query once `finance_bookings` exists in the
> target DB. Persistence (`src/storage/persistence.ts`: last-run timestamp,
> failed-delivery fallback) is still real Postgres — it needs
> `orch_a_runs`/`orch_a_failed_deliveries` to exist, see below.

Package manager: **yarn** (Berry, pinned via `packageManager` in package.json + corepack — always use yarn, not npm, in this repo).

## Setup

```bash
corepack enable   # one-time, if not already done — makes `yarn` resolve to the pinned version
yarn install
yarn lefthook install
cp .env.example .env  # fill in DATABASE_URL (from `supabase start` output, see below),
                       # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, OPENROUTER_API_KEY
```

## Run

```bash
yarn dev              # starts everything needed for local dev: brings up
                       # Supabase (Postgres + Studio, applying
                       # supabase/migrations) if it isn't already running,
                       # then the Mastra dev server (API + Playground/Studio
                       # at http://localhost:4111). Ctrl+C stops the Mastra
                       # dev server; Supabase's containers keep running in
                       # the background (docker ps) — `supabase stop` to stop them.
yarn run:heartbeat    # runs the heartbeat workflow once (what the scheduler invokes)
yarn preview:digest   # prints the Telegram digest text without calling the LLM
                      # or sending anything — for checking copy/formatting changes
```

## Checks

```bash
yarn lint
yarn typecheck
yarn knip
yarn test
```
