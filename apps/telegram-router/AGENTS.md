# Agent instructions: telegram-router

Repo-wide conventions (yarn only, conventional commits, lefthook) are in the
root `AGENTS.md` and apply here too. This file only covers what's specific to
this app.

## No DB, correlation is entirely in-band

There is no database here and no "already handled" check. Two different
correlation mechanisms exist depending on nudge category, don't conflate
them:

- `send_booking_link`: correlation id travels in the tapped inline button's
  `callback_data` (`booking_approve:<id>` / `booking_reject:<id>`), set in
  `src/app/api/owner-nudges/route.ts` and read in
  `src/app/api/telegram/webhook/route.ts`'s `handleCallbackQuery`.
- `missing_info`: correlation id is embedded as a `[ref:<correlationId>]` tag
  at the very end of the composed nudge text. Telegram echoes that full text
  back on `reply_to_message.text` when the owner replies, and
  `handleOwnerNudgeReply` regex-matches it out (`MISSING_INFO_REF_REGEX`).
  Treat the ref token as opaque, non-whitespace, not assumed to be
  UUID-shaped.
- `wants_human` never gets a ref tag. It's a one-way notification; no reply
  is ever expected, so a reply to it just falls through to the noop branch.

A duplicate button tap or a Telegram webhook retry just resends the event to
GCA a second time. That's a deliberate no-op there (GCA's Inngest run either
picks it up once or isn't waiting anymore), not a bug to guard against here.
Don't add a dedup/idempotency check on this side; there's no row to check it
against.

## `{ ok: true }` from a relay call is not a delivery guarantee

`answerOwnerNudge` and `answerBookingLinkApproval` in `src/lib/telegram/gca.ts`
only report whether the HTTP call to GCA succeeded, never whether a suspended
run was actually still waiting on it or whether the guest was actually
messaged. GCA (Inngest-backed) has no signal for that. Don't add logic here
that assumes `ok: true` means the guest received anything.

## The webhook always returns 200 once authenticated

`POST /api/telegram/webhook` returns `NextResponse.json({ ok: true })` on
every branch, including the noop and failure branches, once
`verifyWebhookSecret` passes. A non-2xx makes Telegram retry the whole
update. When adding a new branch, keep returning 200 and surface failures via
`console.error` / span status instead.

## Two separate auth mechanisms, don't mix them up

- Inbound Telegram webhook: `X-Telegram-Bot-Api-Secret-Token` header, checked
  in `verifyWebhookSecret` against `TELEGRAM_WEBHOOK_SECRET`.
- Inbound owner-nudges endpoint (called by GCA): `X-API-Key` header, checked
  in `requireApiKey` against `TELEGRAM_ROUTER_API_KEY`. This app is otherwise
  only ever a caller of other apps' `X-API-Key`-guarded routes, this is its
  one inbound-guarded route.

## Telegram sends are best-effort and no-op without config

`sendMessage`, `answerCallbackQuery`, and `editMessageText` in
`src/lib/telegram/telegram.ts` all return `{ ok: true }` without doing
anything when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aren't set. They don't
throw on delivery failure either, they catch and return `{ ok: false, error
}`, record it on the span, and report it to Sentry. `sendWithRetry` wraps any
send with exactly one retry (two attempts total), used for every send from
`owner-nudges/route.ts`.

## Tests import compiled-style `.js` paths, not `.ts`

Every test under `tests/` imports the modules it exercises (and their
`vi.mock` targets) with a `.js` extension, e.g.
`@/lib/telegram/gca.js`, even though the source files are `.ts`. Source code
itself (`src/**`) imports the same modules without an extension. Follow the
existing test files' pattern when adding a new one rather than mixing
conventions.

## Tracing

Any new code path that calls Telegram's API or GCA's HTTP API should wrap the
call in `withSpan` from `src/lib/tracing.ts` (see the existing call sites in
`gca.ts` and `telegram.ts`) and use `markSpanFailed` on the caught error
instead of only console-logging it, so failures show up in Axiom the same
way existing ones do.
