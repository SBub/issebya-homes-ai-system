# issebya-homes-ai-system

Turborepo/yarn-workspaces monorepo for the issebya.homes automation system. See
`docs/monorepo-migration-plan.md` for how this got structured this way.

## apps/orch-a

Orchestrator agent. See `docs/spec-v0.1.0.md` for the full spec and
`docs/agent-architecture.mmd` for the target-state org chart.

v0.1.0 scope: Analyze -> Decide -> Dispatch (no-op) -> Report loop that reads
Availability + Finance state and runs three health checks. Read-only, no delegate
agents wired yet. No Telegram knowledge of its own — matching the
apps/social-media/apps/notifications precedent, `apps/telegram-router` owns sending
the digest; this app just computes it and hands back ready-to-send text.

Built with [Mastra](https://mastra.ai) (`Agent` + typed tools + `Workflow`), TypeScript.
The heartbeat workflow is exposed as `GET /digest` — a custom Mastra API route
(`registerApiRoute`, see `src/mastra/routes/digest.ts`), `X-API-Key`-protected via
`ORCH_A_API_KEY`. It's reachable at `/digest`, not `/api/digest`: Mastra reserves its
own `/api` prefix for the built-in `/api/agents`, `/api/workflows`, etc. routes that
`mastra dev`/`mastra build`+`mastra start` auto-generate, and rejects custom routes
registered under it. Those auto-generated workflow-execution routes are POST-only and
wrap the result in a run-lifecycle envelope, so a custom route (still running the same
Mastra workflow object in-process) was the cleaner fit for a plain `GET` read.

`yarn run:heartbeat` runs the same loop locally and prints the rendered digest — useful
for manual testing, but `apps/telegram-router`'s `POST /api/cron/check-digest` (calling
`GET /digest` on its own schedule) is the real trigger now.

> **Note:** `apps/orch-a/src/tools/availability.ts` fetches real data — `GET
> issebya.com/api/availability?room=room1|room2` — for the 2 rooms currently live.
> `apps/orch-a/src/tools/finance.ts` still returns fixed stub data instead of querying
> Postgres; swap it for a real query once `finance_bookings` exists in the
> target DB (see `docs/finance/plan.md` and `docs/monorepo-migration-plan.md` —
> `apps/finance` is planned but not built yet). Persistence
> (`apps/orch-a/src/storage/persistence.ts`: last-run timestamp, the dead-man's-switch
> `orch_a_runs` table) is still real Postgres. The old `orch_a_failed_deliveries` table
> is left in place (historical data) but nothing writes to it anymore — that durable
> fallback is now `apps/telegram-router`'s shared `telegram_delivery_failures` table,
> see below.

## apps/telegram-router

Owns all Telegram I/O for the whole system — the one webhook a bot token allows,
registered once. Parses incoming commands/callbacks and dispatches to plain logic APIs
in other apps, which have zero Telegram awareness of their own:
- `/social <idea>` -> `apps/social-media`'s `/api/generate`
- a reminder's "✅ Done" button (`callback_query`) -> `apps/notifications`' ack endpoint
- `POST /api/cron/check-reminders` (`X-Cron-Secret`-protected) -> pulls due reminders
  from `apps/notifications` and sends each one itself, button attached
- `POST /api/cron/check-digest` (`X-Cron-Secret`-protected) -> pulls the rendered digest
  from `apps/orch-a`'s `GET /digest` and sends it itself, with `parse_mode: "HTML"`
  preserved (Orch-A's digest is pre-rendered with `<b>`/`<i>` tags)

Sends every reply/reminder/digest itself, retrying once on failure (matching Orch-A's
old `sendReport` retry behavior). If a send still fails after the retry, it's recorded
in a shared `telegram_delivery_failures` table (Postgres, `DATABASE_URL` — same local
Supabase instance every other app uses) instead of just logged — a durable last-resort
record, not the primary alerting mechanism, shared across all three send paths
(`source` column: `'social'` | `'reminder'` | `'digest'`). This replaces Orch-A's old
per-app `orch_a_failed_deliveries` table now that this router is the sole Telegram
sender for the whole system.

Framed as a "calling system" for now — the plan is for it to grow into an actual
orchestrator (deciding which agent to delegate to) once the systems it calls become
real agents, same analyze -> decide -> dispatch -> report shape as Orch-A, just
reactive instead of scheduled.

> **Note:** only registered against a temporary ngrok tunnel used for testing — no
> permanent public URL yet (same open deployment/hosting question as the rest of this
> repo). Nothing calls `/api/cron/check-reminders` or `/api/cron/check-digest` on a
> real schedule yet either — same unresolved question Orch-A's own heartbeat already had.

## apps/notifications

Notification Center (`NOTIF` in `docs/agent-architecture.mmd`) — reminders that nag until
acknowledged. Plain logic API, no Telegram knowledge: `GET /api/reminders/due` (what's
due to send/re-send right now), `POST /api/reminders/:key/ack` (stop nagging, called from
the Done button), `POST /api/reminders/:key/sent` (record delivery, paces re-nags).
`apps/telegram-router` is the only caller, authenticated via `NOTIFICATIONS_API_KEY`.

A reminder's `reminders` table row (`supabase/migrations/20260720120000_create_reminders.sql`)
is due when unacknowledged, past `due_at`, and either never sent or `renotify_every` has
elapsed since `last_sent_at` (null `renotify_every` = send once, never repeat). Seeded
with the three known candidates from `docs/notification-center-todo.md`.

> **Note:** recurrence (e.g. auto-creating next month's CSV-upload reminder once this
> month's is acknowledged) isn't automated — a documented gap, not an oversight. New
> cycles need a new seed row for now.

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
                       # start` output, see below), ORCH_A_API_KEY (same value as
                       # apps/telegram-router's), OPENROUTER_API_KEY
cp apps/finance/.env.example apps/finance/.env  # fill in DATABASE_URL, FINANCE_API_KEY;
                       # NOTION_*/TELEGRAM_* optional, see the file's own comments
cp apps/social-media/.env.example apps/social-media/.env  # fill in SOCIAL_MEDIA_API_KEY,
                       # OPENROUTER_API_KEY; NOTION_* optional, see the file's own comments
cp apps/telegram-router/.env.example apps/telegram-router/.env  # fill in TELEGRAM_BOT_TOKEN,
                       # TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, SOCIAL_MEDIA_API_URL,
                       # SOCIAL_MEDIA_API_KEY (same value as apps/social-media's),
                       # NOTIFICATIONS_API_URL, NOTIFICATIONS_API_KEY (same value as
                       # apps/notifications'), ORCH_A_API_URL, ORCH_A_API_KEY (same value
                       # as apps/orch-a's), CRON_SECRET, DATABASE_URL (from `supabase
                       # start` output, see below — for the shared
                       # telegram_delivery_failures fallback table)
cp apps/notifications/.env.example apps/notifications/.env  # fill in DATABASE_URL,
                       # NOTIFICATIONS_API_KEY (same value as apps/telegram-router's)
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
