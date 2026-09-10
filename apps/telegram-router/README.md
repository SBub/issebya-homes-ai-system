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

## Setup and running

See the root `README.md`'s Setup and Run sections for the full monorepo
picture (env vars to copy, `yarn dev`, the shared ngrok webhook gateway for
local Telegram + Twilio testing). This app itself runs on port 3003. Copy
`apps/telegram-router/.env.example` to `.env` and fill in the values, each
one documented inline in that file (Telegram bot token/chat id/webhook
secret, the shared key with GCA, Axiom/Sentry observability config).

## Checks

```bash
yarn lint
yarn typecheck
yarn test
```
