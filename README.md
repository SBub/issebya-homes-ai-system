# issebya-homes-ai-system

Turborepo/yarn-workspaces monorepo for the issebya.homes automation system. See
`docs/monorepo-migration-plan.md` for how this got structured this way.

## apps/orch-a

Orchestrator agent. See `docs/spec-v0.1.0.md` for the full spec and
`docs/agent-architecture.mmd` for the target-state org chart.

v0.1.0 scope: scheduled heartbeat that reads Availability + Finance state, runs
three health checks, and reports a digest to Telegram. Read-only, no delegate
agents wired yet.

Built with [Mastra](https://mastra.ai) (`Agent` + typed tools + `Workflow`), TypeScript.

> **Note:** `apps/orch-a/src/tools/availability.ts` fetches real data — `GET
> issebya.com/api/availability?room=room1|room2` — for the 2 rooms currently live.
> `apps/orch-a/src/tools/finance.ts` still returns fixed stub data instead of querying
> Postgres; swap it for a real query once `finance_bookings` exists in the
> target DB (see `docs/finance/plan.md` and `docs/monorepo-migration-plan.md` —
> `apps/finance` is planned but not built yet). Persistence
> (`apps/orch-a/src/storage/persistence.ts`: last-run timestamp, failed-delivery
> fallback) is still real Postgres — it needs `orch_a_runs`/`orch_a_failed_deliveries`
> to exist, see below.

## apps/telegram-router

Owns all Telegram I/O for the whole system — the one webhook a bot token allows,
registered once. Parses incoming commands/callbacks and dispatches to plain logic APIs
in other apps, which have zero Telegram awareness of their own. Currently just `/social
<idea>` -> `apps/social-media`'s `/api/generate`; sends the result back to Telegram
itself. Framed as a "calling system" for now — the plan is for it to grow into an actual
orchestrator (deciding which agent to delegate to) once the systems it calls become real
agents, same analyze -> decide -> dispatch -> report shape as Orch-A, just reactive
instead of scheduled.

> **Note:** only registered against a temporary ngrok tunnel used for testing — no
> permanent public URL yet (same open deployment/hosting question as the rest of this
> repo).

## apps/social-media

Social Media Post Generator (`SOC_GEN` in `docs/agent-architecture.mmd`). A single LLM
call, not an autonomous agent: `POST /api/generate` takes a post idea, generates alt
text (~100 SEO/AEO keywords) and a caption (continues the idea, ends in 5 hashtags), and
writes the result to a Notion table. No Telegram knowledge at all — `apps/telegram-router`
is the only caller, authenticated via `SOCIAL_MEDIA_API_KEY`.

> **Note:** the prompt/model in `src/lib/social/generate.ts` is being iterated against
> real output, not fully tuned.

Package manager: **yarn** (Berry, pinned via `packageManager` in package.json + corepack — always use yarn, not npm, in this repo).

## Setup

```bash
corepack enable   # one-time, if not already done — makes `yarn` resolve to the pinned version
yarn install
yarn lefthook install
cp apps/orch-a/.env.example apps/orch-a/.env  # fill in DATABASE_URL (from `supabase
                       # start` output, see below), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
                       # OPENROUTER_API_KEY
cp apps/finance/.env.example apps/finance/.env  # fill in DATABASE_URL, FINANCE_API_KEY;
                       # NOTION_*/TELEGRAM_* optional, see the file's own comments
cp apps/social-media/.env.example apps/social-media/.env  # fill in SOCIAL_MEDIA_API_KEY,
                       # OPENROUTER_API_KEY; NOTION_* optional, see the file's own comments
cp apps/telegram-router/.env.example apps/telegram-router/.env  # fill in TELEGRAM_BOT_TOKEN,
                       # TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, SOCIAL_MEDIA_API_URL,
                       # SOCIAL_MEDIA_API_KEY (same value as apps/social-media's)
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
