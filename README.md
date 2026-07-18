# issebya-homes-ai-system — Orch-A

Orchestrator agent for the issebya.homes automation system. See `docs/spec-v0.1.0.md`
for the full spec and `docs/agent-architecture.mmd` for the target-state org chart.

v0.1.0 scope: scheduled heartbeat that reads Availability + Finance state directly
from Postgres, runs three health checks, and reports a digest to Telegram.
Read-only, no delegate agents wired yet.

Built with [Mastra](https://mastra.ai) (`Agent` + typed tools + `Workflow`), TypeScript.

> **Note:** `src/tools/availability.ts` and `src/tools/finance.ts` currently return
> fixed stub data instead of querying Postgres — swap them back to real queries
> once `booking_availability`/`finance_bookings` exist in the target DB. Persistence
> (`src/storage/persistence.ts`: last-run timestamp, failed-delivery fallback) is
> still real — it needs `orch_a_runs`/`orch_a_failed_deliveries` to exist, see below.

## Setup

```bash
npm install
npx lefthook install
cp .env.example .env  # fill in DATABASE_URL (from `supabase start` output, see below),
                       # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, OPENROUTER_API_KEY
```

## Run

```bash
npm run dev              # starts everything needed for local dev: brings up
                          # Supabase (Postgres + Studio, applying
                          # supabase/migrations) if it isn't already running,
                          # then the Mastra dev server (API + Playground/Studio
                          # at http://localhost:4111). Ctrl+C stops the Mastra
                          # dev server; Supabase's containers keep running in
                          # the background (docker ps) — `supabase stop` to stop them.
npm run run:heartbeat    # runs the heartbeat workflow once (what the scheduler invokes)
```

## Checks

```bash
npm run lint
npm run typecheck
npm run knip
npm run test
```
