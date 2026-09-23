# Agent instructions: telegram-router

Repo-wide conventions (yarn only, conventional commits, lefthook) are in the
root `AGENTS.md` and apply here too. This file only covers what's specific to
this app. This app is a Python/FastAPI workspace — see root `AGENTS.md`'s
"Python workspaces" section for the two-turbo-package-per-directory shape,
the `--filter=./apps/<dir>` path-filtering requirement, and the exclude-list
maintenance trap.

## No DB, correlation is entirely in-band

There is no database here and no "already handled" check. Two different
correlation mechanisms exist depending on nudge category, don't conflate
them:

- `send_booking_link`: correlation id travels in the tapped inline button's
  `callback_data` (`booking_approve:<id>` / `booking_reject:<id>`), set in
  `app/routers/owner_nudges.py` and read in
  `app/routers/telegram_webhook.py`'s `_handle_callback_query`.
- `missing_info`: correlation id is embedded as a `[ref:<correlationId>]` tag
  at the very end of the composed nudge text. Telegram echoes that full text
  back on `reply_to_message.text` when the owner replies, and
  `_handle_owner_nudge_reply` regex-matches it out (`MISSING_INFO_REF_REGEX`).
  Treat the ref token as opaque, non-whitespace, not assumed to be
  UUID-shaped.
- `send_booking_link` also carries the guest's phone in-band, as a
  `Guest: <phone>` line in the nudge text (composed in `owner_nudges.py`,
  read back from `callback_query.message.text` by
  `BOOKING_LINK_GUEST_PHONE_REGEX`). That line's format is load-bearing.
  Don't turn it into a `[ref:...]` tag, and keep the plain
  `✅ Approved` / `❌ Rejected` fallback for nudges sent without it.
- `wants_human` never gets a ref tag. It's a one-way notification; no reply
  is ever expected, so a reply to it just falls through to the noop branch.

A duplicate button tap or a Telegram webhook retry just resends the event to
GCA a second time. That's a deliberate no-op there (GCA's Inngest run either
picks it up once or isn't waiting anymore), not a bug to guard against here.
Don't add a dedup/idempotency check on this side; there's no row to check it
against.

## `{"ok": True}` from a relay call is not a delivery guarantee

`answer_owner_nudge` and `answer_booking_link_approval` in `app/gca.py` only
report whether the HTTP call to GCA succeeded, never whether a suspended run
was actually still waiting on it or whether the guest was actually messaged.
GCA (Inngest-backed) has no signal for that. Don't add logic here that
assumes `ok: True` means the guest received anything.

## The webhook always returns 200 once authenticated

`POST /api/telegram/webhook` (`app/routers/telegram_webhook.py`) returns
`{"ok": True}` with status 200 on every branch, including the noop and
failure branches, once `verify_webhook_secret` passes. A non-2xx makes
Telegram retry the whole update. This is why the route parses its request
body manually (`await request.json()` wrapped in a broad `except`) instead of
declaring a typed Pydantic request parameter — a typed body would make
FastAPI reject a malformed or unexpected-shape update with its own 422
before this function ever runs. When adding a new branch, keep returning 200
and surface failures via `print(..., file=sys.stderr)` / span status instead.

## Two separate auth mechanisms, don't mix them up

- Inbound Telegram webhook: `X-Telegram-Bot-Api-Secret-Token` header, checked
  in `verify_webhook_secret` (`app/auth.py`) against `TELEGRAM_WEBHOOK_SECRET`.
- Inbound owner-nudges endpoint (called by GCA): `X-API-Key` header, checked
  in `require_api_key` (`app/auth.py`) against `TELEGRAM_ROUTER_API_KEY`. This
  app is otherwise only ever a caller of other apps' `X-API-Key`-guarded
  routes, this is its one inbound-guarded route.

## Telegram sends are best-effort and no-op without config

`send_message`, `answer_callback_query`, and `edit_message_text` in
`app/telegram.py` all return `{"ok": True}` without doing anything when
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aren't set. They don't raise on
delivery failure either — they catch and return `{"ok": False, "error"}`,
record it on the span, and report it to Sentry. `send_with_retry` wraps any
send with exactly one retry (two attempts total), used for every send from
`owner_nudges.py`.

## Tracing

Any new code path that calls Telegram's API or GCA's HTTP API should wrap the
call in `with_span` from `app/tracing.py` (see the existing call sites in
`gca.py` and `telegram.py`) and use `mark_span_failed` on the caught
exception instead of only printing it, so failures show up in Axiom the same
way existing ones do.

Every request force-flushes the tracer provider through the HTTP middleware
in `app/main.py`. A new route gets that for free — don't give it its own
flush call.

A flush must never change a response. Both `flush_tracing` and the
middleware that calls it swallow and log; if you touch either, keep that
contract. A raising flush on the webhook would turn a 200 into a 500 and
make Telegram retry the update.

There is no heartbeat span any more, and no heartbeat task to re-add. It fed
an Axiom dead-man's-switch monitor, but this app runs as a request-driven
Vercel Function, so a timer-driven task can't fire reliably and the monitor
would alarm on a healthy system. `GET /api/health` is the daemon-free
replacement.

`GET /api/health` is unauthenticated and uninstrumented on purpose — it
exposes nothing and it's polled on a schedule. Don't wrap it in `with_span`.
