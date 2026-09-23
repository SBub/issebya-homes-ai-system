# telegram-router

Owns all Telegram I/O for the issebya.homes system. Every Telegram message the
owner sends or receives goes through this app; nothing else in the repo talks
to the Telegram Bot API directly.

It sits between the owner's Telegram chat and
`apps/guest-communication-agent` (GCA): GCA escalates to the owner (missing
info, "wants human", or a booking link that needs approval) through this
app's `POST /api/owner-nudges`, and this app's webhook resolves the owner's
replies and button taps back into GCA's human-in-the-loop gates.

It's a thin dispatcher, not an agent. No database, no business logic beyond
routing: it reads a Telegram update, figures out which correlation id it
belongs to, and calls one of GCA's plain HTTP APIs. Correlation is entirely
in-band, no DB lookups:

- Booking-link approve/reject: the correlation id rides in the tapped inline
  button's `callback_data` (`booking_approve:<id>` / `booking_reject:<id>`).
- Missing-info replies: the correlation id is embedded as a `[ref:<id>]` tag
  at the end of the original nudge text; Telegram echoes that text back on
  `reply_to_message`, so the webhook regex-matches it out of the owner's
  reply instead of looking anything up.

## Routes

- `POST /api/telegram/webhook`: the one Telegram webhook. Handles
  `callback_query` updates (booking link Approve/Reject) and message replies
  to missing-info nudges. Guarded by Telegram's own
  `X-Telegram-Bot-Api-Secret-Token` header. Always answers 200 once
  authenticated, since a non-2xx makes Telegram retry the whole update.
- `POST /api/owner-nudges`: inbound endpoint for GCA's owner-nudge tool.
  Composes and sends the Telegram message for one of three categories
  (`missing_info`, `wants_human`, `send_booking_link`), the last one with
  inline Approve/Reject buttons. Guarded by `X-API-Key` against
  `TELEGRAM_ROUTER_API_KEY`.
- `GET /api/health`: returns `{"ok": true}`. Unauthenticated and
  uninstrumented, the target for the external uptime check that watches this
  app's liveness.

## Setup and running

See the root `README.md`'s Setup and Run sections for the full monorepo
picture (env vars to copy, `yarn dev`, the shared ngrok webhook gateway for
local Telegram + Twilio testing). This app itself runs on port 3003, on
`uv run uvicorn` (a FastAPI/Python app, not Next.js). Copy
`apps/telegram-router/.env.example` to `.env` and fill in the values, each
one documented inline in that file (Telegram bot token/chat id/webhook
secret, the shared key with GCA, Axiom/Sentry observability config).

## Deployment

Deployed on Vercel as the project `ihas-telegram-router`, with Root Directory
`apps/telegram-router` and framework preset `FastAPI`. It runs as a single
Vercel Function with Fluid compute. The entrypoint is declared as
`app.main:app` under `[tool.vercel]` in `pyproject.toml`; Vercel's own
filename detection would find `app/main.py` anyway, but stating it is
Vercel's recommendation for new projects.

Dependencies come from `pyproject.toml`, resolved with uv against the
repo-root `uv.lock`. There is deliberately no `requirements.txt` (it would be
a second source of truth for the same dependency list).

`vercel.json` exists for exactly one reason, and it is load-bearing. Vercel
detects the repo-root `turbo.json` and, unless told otherwise, sets this
project's Install Command to `yarn install` and its Build Command to
`turbo run build`. Vercel's Python builder treats any custom Install Command
as "dependencies are already installed" and skips its own `uv sync`. The
result is a green build whose function bundle contains no Python packages
at all, and every request, `/api/health` included, fails with
`ModuleNotFoundError` (the first import in `app/main.py` that isn't stdlib,
`sentry_sdk`). That is how this app shipped dead to production on
2026-09-22 and stayed that way for 17 hours. So `vercel.json` pins:

- `installCommand`: `uv sync --frozen --no-dev --no-editable --package
telegram-router`. Runs in this directory with the builder's virtualenv
  active (`VIRTUAL_ENV`/`UV_PROJECT_ENVIRONMENT` are set by the builder),
  so uv resolves the workspace, finds the root lockfile, and installs only
  this member's runtime dependencies into the venv the builder then bundles.
- `buildCommand`: `python -c 'import app.main'`. There is nothing to build;
  this is a smoke import with the venv's Python, so a missing dependency
  fails the build loudly instead of every request at runtime.

After any deploy, `curl <deployment>/api/health` must return
`{"ok": true}`. A `FUNCTION_INVOCATION_FAILED` page there means the bundle
has no dependencies again.

The registered Telegram webhook URL is a contract. Telegram holds the
deployed domain plus `/api/telegram/webhook`; change either and every inbound
update stops arriving, silently, with no error anywhere.

### Telemetry on a Function

A Vercel Function only runs while it is serving a request, which breaks two
things a long-lived uvicorn process gets for free:

- Spans are force-flushed once per request by an HTTP middleware in
  `app/main.py`, because `BatchSpanProcessor`'s own timer isn't guaranteed to
  fire before the instance goes away. Without that, spans are silently
  dropped.
- There is no heartbeat task. Liveness is an external uptime ping against
  `GET /api/health` instead of an Axiom dead-man's-switch monitor on
  heartbeat spans, which a request-driven function cannot keep fed.

## Checks

This workspace is a Python uv member, so a bare `yarn lint`/`yarn typecheck`/
`yarn test` run from inside the app directory doesn't resolve the right
turbo package once the workspace splits in two (see root `AGENTS.md`'s
Python section). Use the path-filtered form instead:

```bash
yarn turbo run lint --filter=./apps/telegram-router
yarn turbo run typecheck --filter=./apps/telegram-router
yarn turbo run test --filter=./apps/telegram-router
```
