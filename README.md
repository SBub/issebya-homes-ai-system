# issebya-homes-ai-system

Turborepo/yarn-workspaces monorepo for the issebya.homes automation system. See
`docs/monorepo-migration-plan.md` for how this got structured this way.

## apps/telegram-router

Owns all Telegram I/O for the whole system — the one webhook a bot token allows,
registered once. Parses incoming commands/callbacks and dispatches to plain logic APIs
in other apps, which have zero Telegram awareness of their own:
- `/social <idea>` -> `apps/social-media`'s `/api/generate`
- `/cron list` -> replies with the manifest in `src/lib/telegram/cron-jobs.ts` (what
  cron endpoints exist, since nothing calls them on a real schedule yet)
- `/heartbeat` -> runs a real system liveness check right now, on demand — same
  underlying check (`src/lib/telegram/health-monitor.ts`'s `runCheckHealth`) as
  `check-health` below, just triggered by the user instead of a schedule. Always
  replies with every service's current status (unlike the scheduled path, a manual
  trigger means "tell me now," not just "page me if something changed")
- a reminder's "✅ Done" button (`callback_query`) -> `apps/notifications`' ack endpoint
- `POST /api/cron/check-reminders` (`X-Cron-Secret`-protected) -> pulls due reminders
  from `apps/notifications` and sends each one itself, button attached
- `POST /api/cron/check-health` (`X-Cron-Secret`-protected) -> checks each service's
  liveness (`apps/notifications`, `apps/finance`, `apps/social-media` —
  this router excludes itself, see `src/lib/telegram/health-targets.ts`'s doc comment)
  and alerts via Telegram only on a healthy↔unhealthy transition, persisted in the
  `health_check_state` table (Postgres) so restarts don't lose known-bad state and cause
  a spurious re-alert or a silently-swallowed recovery message. This
  is the `HEALTH` node in `docs/agent-architecture.mmd`, previously marked "needs design."

Sends every reply/reminder itself, retrying once on failure. If a send still fails
after the retry, it's recorded in a shared `telegram_delivery_failures` table (Postgres,
`DATABASE_URL` — same local Supabase instance every other app uses) instead of just
logged — a durable last-resort record, not the primary alerting mechanism, shared across
all send paths (`source` column: `'social'` | `'reminder'` | `'health'`).

Framed as a "calling system" for now — the plan is for it to grow into an actual
orchestrator (deciding which agent to delegate to) once the systems it calls become
real agents, reactive instead of scheduled.

> **Note:** only registered against a temporary ngrok tunnel used for testing — no
> permanent public URL yet (same open deployment/hosting question as the rest of this
> repo). Nothing calls `/api/cron/check-reminders` on a real schedule yet either.

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
call, not an autonomous agent: `POST /api/generate` takes a post idea and generates alt
text (~100 SEO/AEO keywords) and a caption (continues the idea, ends in 5 hashtags). No
Telegram knowledge at all — `apps/telegram-router` is the only caller, authenticated via
`SOCIAL_MEDIA_API_KEY`.

> **Note:** the prompt/model in `src/lib/social/generate.ts` is being iterated against
> real output, not fully tuned.

## apps/guest-communication-agent

Guest-Comms Agent (`GCA` in `docs/agent-architecture.mmd`) — ported (2026-07-20) from
`issebya-homes-website` once that repo's merge conflict was resolved. Faithful port, not a
redesign: same reasoning/tools as the source repo, same tools (pricing, availability,
booking links, property Q&A via pgvector, escalate-to-owner). Originally ported as a
LangGraph.js `StateGraph`; simplified 2026-08-03 to a single plain async tool-calling loop
(`src/agent/run-turn.ts`'s `runAgentTurn` — `loadContext -> model <-> 5 tools -> final
reply`) once it was clear GCA is, and is staying, a single agent with no multi-agent
routing/supervision, so the graph machinery wasn't earning its keep — same runtime
behavior, just without the StateGraph/node/checkpointer ceremony (see
`docs/agent-architecture-details.md`'s GCA section for the full history). Its
only real dependency the destination lacked was `packages/shared`'s two Supabase client
factories, inlined directly (`src/lib/supabase.ts`) since this monorepo has no `packages/*`
workspace — otherwise a straight copy, including keeping Supabase-JS (`.from()`/`.rpc()`)
rather than rewriting to this repo's usual raw `pg.Pool` convention.

`POST /api/webhook/whatsapp` validates a real `X-Twilio-Signature` (`src/lib/twilio.ts`,
hand-implemented HMAC-SHA1, no `twilio` SDK dependency) and runs the agent turn for real —
verified live end-to-end (signature check -> conversation created/looked-up -> inbound
message recorded -> graph reaches the agent node).

> **Note: not yet actually live.** The agent node pulls its system prompt from Braintrust
> at runtime (project `BRAINTRUST_PROJECT_ID`, slug `gca-system`) — it is not a file
> anywhere in this repo. No real Twilio account/WhatsApp number is configured either.
> Without both, a real inbound message fails — confirmed live.
>
> **Known gaps carried over, not yet resolved:**
> - `guest_contacts` has no committed migration anywhere in the source repo's history
>   despite being referenced as real by its own docs — `supabase/migrations/20260720150002_create_guest_contacts_reconstructed.sql`
>   here is a hand-reconstructed minimal version (columns the ported code actually reads,
>   plus what source docs describe), not a verified copy of a real schema.
> - Escalation alerts (`escalateToOwner` tool, the agent's step-cap safety net) still send
>   Telegram directly (own bot token/chat ID), bypassing `apps/telegram-router` like every
>   other app here already does — ported as-is; routing this through the router instead is
>   a deliberate, separate decision not made yet.
> - `checkAvailability`/`sendBookingLink` call the live `issebya.com/api/availability`
>   directly (`NEXT_PUBLIC_SITE_URL`) — moving the code didn't remove this cross-repo
>   runtime dependency.

Package manager: **yarn** (Berry, pinned via `packageManager` in package.json + corepack — always use yarn, not npm, in this repo).

## Setup

```bash
corepack enable   # one-time, if not already done — makes `yarn` resolve to the pinned version
yarn install
yarn lefthook install
cp apps/finance/.env.example apps/finance/.env  # fill in DATABASE_URL, FINANCE_API_KEY;
                       # TELEGRAM_* optional, see the file's own comments
cp apps/social-media/.env.example apps/social-media/.env  # fill in SOCIAL_MEDIA_API_KEY,
                       # OPENROUTER_API_KEY
cp apps/telegram-router/.env.example apps/telegram-router/.env  # fill in TELEGRAM_BOT_TOKEN,
                       # TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, SOCIAL_MEDIA_API_URL,
                       # SOCIAL_MEDIA_API_KEY (same value as apps/social-media's),
                       # NOTIFICATIONS_API_URL, NOTIFICATIONS_API_KEY (same value as
                       # apps/notifications'), FINANCE_API_URL, FINANCE_API_KEY (same value
                       # as apps/finance's — used only for /api/health today), CRON_SECRET,
                       # DATABASE_URL (from `supabase start` output, see below — for the
                       # shared telegram_delivery_failures + health_check_state tables)
cp apps/notifications/.env.example apps/notifications/.env  # fill in DATABASE_URL,
                       # NOTIFICATIONS_API_KEY (same value as apps/telegram-router's)
cp apps/guest-communication-agent/.env.example apps/guest-communication-agent/.env  # fill in
                       # SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (from
                       # `supabase status`, Publishable/Secret on newer CLI versions),
                       # OPENROUTER_API_KEY (same key apps/social-media uses),
                       # BRAINTRUST_API_KEY/BRAINTRUST_PROJECT_ID (AI observability +
                       # prompt management — see that app's own .env.example comment),
                       # TWILIO_AUTH_TOKEN/TWILIO_WEBHOOK_URL once a real Twilio account
                       # exists, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (same bot every app
                       # uses), NEXT_PUBLIC_SITE_URL
```

## Run

```bash
yarn dev              # starts every app's dev server in parallel (turbo run dev) —
                       # apps/finance :3001, apps/social-media :3002,
                       # apps/telegram-router :3003, apps/notifications :3004,
                       # apps/guest-communication-agent (tsx watch), apps/crm :3006.
                       # Bring up Supabase yourself first (`supabase start`,
                       # applying supabase/migrations) — Ctrl+C stops the dev
                       # servers; Supabase's containers keep running in the
                       # background (docker ps) — `supabase stop` to stop them.
```

## Checks

```bash
yarn lint
yarn typecheck
yarn knip
yarn test
```
