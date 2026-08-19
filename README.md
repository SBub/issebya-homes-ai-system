# issebya-homes-ai-system

Turborepo/yarn-workspaces monorepo for the issebya.homes automation system. See
`docs/monorepo-migration-plan.md` for how this got structured this way.

## apps/telegram-router

Owns all Telegram I/O for the whole system (the one webhook a bot token allows,
registered once). Parses incoming commands/callbacks and dispatches to plain logic APIs
in other apps, which have zero Telegram awareness of their own:
- `/social <idea>` -> `apps/social-media`'s `/api/generate`
- Inline Approve/Reject button callbacks -> resolves owner-nudge approvals for
  `apps/guest-communication-agent`'s HITL gates (booking-link approval, missing-info
  answers) via `POST /api/owner-nudges`
- `POST /api/campaign-drafts` -> receives drafted promo-code nudges from
  `apps/crm`'s stalled-guest cron for owner approve/reject

Sends every reply itself, retrying once on failure.

**2026-08-07: the `telegram_delivery_failures` durable-fallback table removed**, along with `src/lib/telegram/delivery-failures.ts` and `src/lib/telegram/db.ts`
(the `pg` pool that existed only for this). Delivery-failure monitoring will be
handled via OTel instead, not a DB table. The table itself was dropped: see
`supabase/migrations/20260807110000_drop_telegram_delivery_failures.sql`.

**2026-08-07: the health-monitor feature removed entirely**: the `/heartbeat`
command, `POST /api/cron/check-health`, `src/lib/telegram/health-monitor.ts` and
`health-targets.ts`, and both `apps/finance`'s and
`apps/guest-communication-agent`'s own `GET /api/health` routes. It was the
`HEALTH` node in `docs/agent-architecture.mmd`. The `health_check_state` table
(created by `supabase/migrations/20260720140000_create_health_check_state.sql`)
has since been dropped entirely: see
`supabase/migrations/20260807100000_drop_dead_tables.sql`.

Framed as a "calling system" for now; the plan is for it to grow into an actual
orchestrator (deciding which agent to delegate to) once the systems it calls become
real agents, reactive instead of scheduled.

> **Note:** only registered against a temporary ngrok tunnel used for testing, with no
> permanent public URL yet (same open deployment/hosting question as the rest of this
> repo).

**2026-08-07: `apps/notifications` removed**, along with its `apps/telegram-router`
integration (the reminder "✅ Done" button, `POST /api/cron/check-reminders`, and the
`notifications` liveness target). It was Notification Center (`NOTIF` in
`docs/agent-architecture.mmd`): reminders that nag until acknowledged. Its
`reminders` table (created by
`supabase/migrations/20260720120000_create_reminders.sql`) has since been
dropped entirely: see
`supabase/migrations/20260807100000_drop_dead_tables.sql`.

## apps/social-media

Social Media Post Generator (`SOC_GEN` in `docs/agent-architecture.mmd`). A single LLM
call, not an autonomous agent: `POST /api/generate` takes a post idea and generates alt
text (~100 SEO/AEO keywords) and a caption (continues the idea, ends in 5 hashtags). No
Telegram knowledge at all: `apps/telegram-router` is the only caller, authenticated via
`SOCIAL_MEDIA_API_KEY`.

> **Note:** the prompt/model in `src/lib/social/generate.ts` is being iterated against
> real output, not fully tuned.

## apps/guest-communication-agent

Guest-Comms Agent (`GCA` in `docs/agent-architecture.mmd`), **live** since 2026-07-21
via the Twilio WhatsApp Sandbox. Originally ported (2026-07-20) from
`issebya-homes-website` as a LangGraph.js `StateGraph`; simplified 2026-08-03 to a
single plain async tool-calling loop (`src/agent/run-turn.ts`'s `runAgentTurn`) once it
was clear GCA is, and is staying, a single agent with no multi-agent
routing/supervision, so the graph machinery wasn't earning its keep (see
`docs/agent-architecture-details.md`'s GCA section for the full history, and this app's
own `ENGINEERING.md` for a full technical walkthrough).

Tools: `get_pricing`, `check_availability`, `answer_property_question` (pgvector
similarity search), `send_booking_link` (gated behind owner Telegram approval),
`get_current_date`, `run_code` (sandboxed, for multi-step lookups in one tool call),
`wants_human` (one-way owner escalation), `missing_info` (suspends the turn and asks
the owner, writing their answer back into the knowledge base).

Durable execution is via **Inngest**, not DBOS (replaced) or a LangGraph checkpointer:
`POST /api/webhook/whatsapp` validates a real `X-Twilio-Signature`
(`src/lib/twilio.ts`, hand-implemented HMAC-SHA1, no `twilio` SDK dependency) and fires
an Inngest event rather than running the turn inline, so the webhook returns
immediately and a turn can suspend for hours (owner approval, missing-info answer)
without holding the request open.

> **Known gaps, not yet resolved:**
> - `guest_contacts` has no committed migration anywhere in the source repo's history
>   despite being referenced as real by its own docs: `supabase/migrations/20260720150002_create_guest_contacts_reconstructed.sql`
>   here is a hand-reconstructed minimal version (columns the ported code actually reads,
>   plus what source docs describe), not a verified copy of a real schema.
> - `check_availability`/`send_booking_link` call the live `issebya.com/api/availability`
>   directly (`NEXT_PUBLIC_SITE_URL`): a cross-repo runtime dependency the port never
>   removed.
> - The AI SDK migration (away from LangChain) lost automatic LangSmith tracing;
>   `whatsapp_messages.langsmith_run_id` is still generated/stored but no longer
>   corresponds to a real trace. Unresolved: either bridge OTel to LangSmith, or drop
>   the feedback-correlation feature that depends on it.

Package manager: **yarn** (Berry, pinned via `packageManager` in package.json + corepack; always use yarn, not npm, in this repo).

## apps/crm

Owns guest identity and campaign-conversion tracking, split out of
`apps/guest-communication-agent` on 2026-07-21 so GCA itself stays stateless about
marketing. Owns `guest_contacts` (auto-populated from `apps/finance`'s uploaded
bookings via `POST /api/guest-contacts/sync`; phone numbers are still added by a human
directly in Supabase Studio, with no dedicated UI for that yet) and a forward-only
`funnel_stage` (`new -> informed -> link_sent -> booked`) bumped every GCA turn via
`POST /api/guest-contacts/touch`.

`POST /api/cron/check-stalled-guests` finds funnel-stalled guests and drafts a
promo-code nudge for owner approve/reject via `apps/telegram-router`; `campaigns`/
`promo_codes` tables back that lifecycle (`GET /api/campaigns/stats` exposes a
PII-free aggregate view). No real external scheduler triggers this cron yet: it's
callable, not yet on a live cadence.

> **Known gap:** issued/sent/rejected promo codes are tracked, but there's no real
> redemption/conversion-to-paid-booking tracking yet: `redeemed` is always reported as
> 0 since nothing writes it, pending a separate, still-paused website checkout change.

## Setup

```bash
corepack enable   # one-time, if not already done, makes `yarn` resolve to the pinned version
yarn install
yarn lefthook install
cp apps/finance/.env.example apps/finance/.env  # fill in DATABASE_URL, FINANCE_API_KEY;
                       # TELEGRAM_* optional, see the file's own comments
cp apps/social-media/.env.example apps/social-media/.env  # fill in SOCIAL_MEDIA_API_KEY,
                       # OPENROUTER_API_KEY
cp apps/telegram-router/.env.example apps/telegram-router/.env  # fill in TELEGRAM_BOT_TOKEN,
                       # TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, SOCIAL_MEDIA_API_URL,
                       # SOCIAL_MEDIA_API_KEY (same value as apps/social-media's)
cp apps/guest-communication-agent/.env.example apps/guest-communication-agent/.env  # fill in
                       # SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (from
                       # `supabase status`, Publishable/Secret on newer CLI versions),
                       # OPENROUTER_API_KEY (same key apps/social-media uses),
                       # BRAINTRUST_API_KEY/BRAINTRUST_PROJECT_ID (AI observability +
                       # prompt management, see that app's own .env.example comment),
                       # TWILIO_AUTH_TOKEN/TWILIO_ACCOUNT_SID/TWILIO_WEBHOOK_URL/
                       # TWILIO_WHATSAPP_FROM (Sandbox values work for local dev),
                       # TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (same bot every app
                       # uses), NEXT_PUBLIC_SITE_URL
cp apps/crm/.env.example apps/crm/.env  # fill in SUPABASE_URL/SUPABASE_ANON_KEY/
                       # SUPABASE_SERVICE_ROLE_KEY, CRM_API_KEY, TELEGRAM_ROUTER_API_URL/
                       # TELEGRAM_ROUTER_API_KEY, GUEST_COMMUNICATION_AGENT_API_URL/
                       # GUEST_COMMUNICATION_AGENT_API_KEY, OPENROUTER_API_KEY
```

## Run

```bash
yarn dev              # starts every app's dev server in parallel (turbo run dev):
                       # apps/finance :3001, apps/social-media :3002,
                       # apps/telegram-router :3003,
                       # apps/guest-communication-agent (tsx watch), apps/crm :3006.
                       # Bring up Supabase yourself first (`supabase start`,
                       # applying supabase/migrations); Ctrl+C stops the dev
                       # servers; Supabase's containers keep running in the
                       # background (docker ps); `supabase stop` to stop them.
```

## Checks

```bash
yarn lint
yarn typecheck
yarn knip
yarn test
```
