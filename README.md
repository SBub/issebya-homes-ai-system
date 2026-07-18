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
supabase start   # local Supabase CLI dev stack (Postgres + Studio); applies
                 # supabase/migrations, including orch_a_runs/orch_a_failed_deliveries
cp .env.example .env  # fill in DATABASE_URL (from `supabase start` output),
                       # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, OPENROUTER_API_KEY
```

## Run

```bash
npm run run:heartbeat   # runs the heartbeat workflow once (what the scheduler invokes)
npm run dev              # Mastra dev server, for interactively inspecting/testing the agent
```

## Checks

```bash
npm run lint
npm run typecheck
npm run knip
npm run test
```
