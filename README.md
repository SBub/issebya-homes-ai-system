# issebya-homes-ai-system

Turborepo/yarn-workspaces monorepo for issebya.homes, a real short-term rental
business. Three apps, one flow: a guest books on the **website**, then talks to
the **guest communication agent** over WhatsApp, which escalates to the owner
through the **Telegram router** whenever a decision needs a human.

## Flow

```
guest -> apps/website (booking, payment)
guest -> apps/guest-communication-agent (WhatsApp Q&A, booking links)
                |
                v  needs owner input (approval, missing info)
         apps/telegram-router -> owner -> back into the agent
```

## Projects

**apps/website** - guest-facing booking site. Guest picks a room, pays via
Stripe Checkout, gets a confirmation, and issebya's own bookings re-export as
an iCal feed back to the listing sites.

Architecture: Next.js, server-side rendered booking pages. Availability
merges external iCal feeds (Airbnb/VRBO/Booking.com) with the site's own
bookings table at request time, so pages never serve stale availability.

**apps/guest-communication-agent** (GCA) - WhatsApp agent for guest
questions, pricing, availability, and booking links, live since 2026-07-21.
See `ENGINEERING.md` in that app for the full technical walkthrough.

Architecture, the core agentic harness:

- human-in-the-loop gates: booking-link approval and missing-info questions
  suspend a turn and route to the owner instead of guessing
- tool calling: pricing, availability, knowledge-base lookup, booking links,
  sandboxed code execution
- a single agentic tool-calling loop
- durable execution via Inngest, so a turn can sit suspended for hours
  waiting on a human without holding a request open
- sandboxing for the `run_code` tool, so multi-step lookups don't run
  arbitrary code directly in the app process
- online evals plus a CI eval gate (Braintrust), so prompt/model changes are
  checked against a golden dataset before they reach guests
- full instrumentation: OpenTelemetry traces every guest turn to both
  Braintrust (AI-call observability) and Axiom (general app health), plus
  Sentry error tracking in production

**apps/telegram-router** - owns all Telegram I/O for the system and resolves
owner Approve/Reject callbacks back into GCA's HITL gates.

Architecture: thin I/O layer, one webhook, dispatches to plain APIs on the
other apps. Not much to it by design; it stays dumb so the agent stays the
one place with actual logic.

**Cross-cutting**: every app is left-shift audited with static analysis
(lint, typecheck, knip, format) as a required CI gate on every merge to
`develop`.

See `docs/monorepo-migration-plan.md` for how the repo got structured this
way, and `docs/agent-architecture-details.md` for deeper architecture notes.

## Setup

```bash
corepack enable   # one-time, if not already done, makes `yarn` resolve to the pinned version
yarn install           # also installs the lefthook git hooks (postinstall)
cp apps/telegram-router/.env.example apps/telegram-router/.env  # fill in TELEGRAM_BOT_TOKEN,
                       # TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET
cp apps/guest-communication-agent/.env.example apps/guest-communication-agent/.env  # fill in
                       # SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (from
                       # `yarn supabase status`, Publishable/Secret on newer CLI versions),
                       # OPENROUTER_API_KEY,
                       # BRAINTRUST_API_KEY/BRAINTRUST_PROJECT_ID (AI observability +
                       # prompt management, see that app's own .env.example comment),
                       # TWILIO_AUTH_TOKEN/TWILIO_ACCOUNT_SID/TWILIO_WEBHOOK_URL/
                       # TWILIO_WHATSAPP_FROM (Sandbox values work for local dev),
                       # TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (same bot every app
                       # uses), NEXT_PUBLIC_SITE_URL
cp apps/website/.env.example apps/website/.env  # fill in SUPABASE_URL/SUPABASE_ANON_KEY/
                       # SUPABASE_SERVICE_ROLE_KEY (its own, separate Supabase project —
                       # `yarn supabase start` from apps/website/, not the repo root), STRIPE_*,
                       # RESEND_*, ROOM1_ICAL_*/ROOM2_ICAL_*, see the file's own comments
```

`supabase` and `lefthook` are both project devDependencies (`yarn supabase`, `yarn lefthook`), not tools you install globally yourself.

## Run

```bash
yarn dev              # starts every app's dev server in parallel (turbo run dev):
                       # apps/telegram-router :3003, apps/guest-communication-agent (tsx watch),
                       # apps/website :3000.
                       # Bring up Supabase yourself first (`yarn supabase start`,
                       # applying supabase/migrations); Ctrl+C stops the dev
                       # servers; Supabase's containers keep running in the
                       # background (docker ps); `yarn supabase stop` to stop them.
                       # apps/website runs its own separate Supabase project — bring that
                       # up separately too (`cd apps/website && yarn supabase start`).
```

### Local webhook testing (Twilio + Telegram over one ngrok tunnel)

This repo has exactly one reserved ngrok domain (`kerchief-coveted-remorse.ngrok-free.dev`),
which can only forward to one local port at a time — a second simultaneous tunnel on the
same domain fails with `ERR_NGROK_334`. Twilio's WhatsApp webhook needs
`apps/guest-communication-agent` (:3005) and Telegram's bot webhook needs
`apps/telegram-router` (:3003) — two different local services, one shared public hostname.

`scripts/dev-webhook-gateway.ts` (run via `yarn dev:webhook-gateway` from the repo root)
exists to solve exactly this: a plain path-based HTTP proxy listening on :3010, forwarding
`/api/webhook/whatsapp` -> :3005 and `/api/telegram/webhook` -> :3003. Point ngrok at the
gateway port (`ngrok http 3010`), not at either app's own port directly — pointing ngrok
straight at one app's port silently breaks the other's webhook (both Twilio's
`TWILIO_WEBHOOK_URL` and Telegram's registered webhook already use this domain + their own
path, so nothing needs re-registering when you do this correctly). See the script's own doc
comment for the full mechanics before touching ngrok in this repo, or
`docs/ngrok-webhook-gateway-sop.md` for the step-by-step SOP.

## Checks

```bash
yarn lint
yarn typecheck
yarn knip
yarn test
```
