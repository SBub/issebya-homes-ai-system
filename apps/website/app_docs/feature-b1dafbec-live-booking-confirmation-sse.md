# Live booking confirmation via Server-Sent Events

**ADW ID:** b1dafbec
**Date:** 2026-09-29
**Specification:** specs/issue-193-adw-b1dafbec-sdlc_planner-live-booking-confirmation-sse.md

After Stripe Checkout the guest lands on `/booking/confirmation?session=<id>`.
The page shows the booking's post-payment steps as they happen, without a
refresh: `Payment received`, `Booking confirmed`, `Confirmation sent to <email>`,
`We have been notified`.

## The step timestamps

Migration `supabase/migrations/20260929120000_add_booking_step_timestamps.sql`
adds three nullable `timestamptz` columns to `public.bookings`:

| Column                | Written by                                                                                                      | When                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `confirmed_at`        | Stripe webhook (`api/webhook/stripe`), and `api/bookings/direct` on its recovery and Stripe-fallback insert paths | In the same update/insert that sets `status = 'confirmed'` |
| `guest_email_sent_at` | Stripe webhook                                                                                                  | After `sendBookingConfirmationEmail` resolves              |
| `owner_email_sent_at` | Stripe webhook                                                                                                  | After `sendBookingNotificationEmail` resolves              |

A failed send leaves its column null. A failed timestamp write is reported to
Sentry (tag `booking.step`) and never changes the webhook's response, so Stripe
does not retry a confirmed booking over it. RLS and grants are unchanged
(service role only), and `booking_availability` does not expose the columns.

Rows confirmed before the migration were backfilled with all three set to
`updated_at`, so an old confirmation link renders the finished timeline
statically instead of streaming for 90 s.

## The step model

`src/lib/bookings/steps.ts` is pure and imports nothing server-only, because
both the route and the client island use it.

| Id  | Event              | True when                                           |
| --- | ------------------ | --------------------------------------------------- |
| 1   | `payment_received` | `status = 'confirmed'` or `confirmed_at` is set     |
| 2   | `confirmed`        | `confirmed_at` is set                               |
| 3   | `guest_email_sent` | `guest_email_sent_at` is set                        |
| 4   | `owner_email_sent` | `owner_email_sent_at` is set                        |
| 5   | `done`             | all four above                                      |

`computeEvents(row)` returns an ordered subset, not a prefix: a failed guest
email leaves id 3 out while id 4 can still appear, and `done` never comes.
`nextEvents(row, lastId)` filters to ids above `lastId`.

## The route: `GET /api/bookings/[token]/events`

`token` is `bookings.access_token`, never the UUID.

- An invalid token (not 64 hex chars), an unknown one or a cancelled booking
  gets a JSON `404` before any stream is created. A lookup error gets a JSON
  `500`.
- Headers: `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. No
  `Connection` header, no `runtime` or `dynamic` export (`cacheComponents` is
  on; reading `request` already makes the handler dynamic).
- Frames are `id: <n>\nevent: <name>\ndata: {}\n\n`. The events already true
  are written at once, then the row is re-read every 1 s and only new events
  are written.
- `: ping\n\n` every 15 s keeps proxies from closing an idle connection.
- The stream ends on `done`; on `event: timeout` at 90 s; on `event: error`
  when a poll fails; or when the client disconnects. `timeout` and `error`
  carry no `id`, so they never move the client's `Last-Event-ID`.
- `Last-Event-ID` (sent by the browser on auto-reconnect) is honoured: only
  events above it are written. Anything that is not an integer 0 to 5 counts
  as 0.
- One idempotent `cleanup()` clears every timer, removes the abort listener
  and closes the controller. It runs on `request.signal` abort and on the
  stream's `cancel()`, so a disconnected client is never polled for again.
  Polling uses a self-rescheduling `setTimeout`, so a slow query cannot
  overlap the next.

Polling rather than Supabase Realtime: the webhook usually finishes within
seconds, so a page costs a handful of indexed single-row reads (at most about
90), with no new infrastructure. The 90 s bound keeps each invocation well
inside Vercel's function limit, so no `maxDuration` is needed.

## The client: `ConfirmationTimeline`

`src/app/(main)/booking/confirmation/ui/ConfirmationTimeline.tsx`, a
`"use client"` island rendered by the confirmation page.

- Seeded from the server-rendered row (`/api/bookings/direct` returns the
  three timestamps), so the lines already true are in the HTML without
  JavaScript.
- Opens an `EventSource` only when there is a token and the booking is not
  already done. The `direct` route's "insert failed, answer from Stripe"
  branch has no token, so that page renders statically.
- Adding a step is idempotent: a fresh connection re-sends the seeded steps.
- Closes on `done`, on `timeout` (and shows `TIMEOUT_COPY`), and on the
  server's `event: error` (a `MessageEvent`). A plain connection `error` is
  left to the browser's auto-reconnect.
- Fires `booking_confirmation_stream_completed { steps, seconds }` once on
  `done`, and no event per step.

The copy lives in `STEP_LABELS` and `TIMEOUT_COPY`, which the browser test and
the e2e spec import.

## Reusing the pattern for another live status page

1. Record each step as a timestamp column written where the step happens.
2. Write a pure `computeEvents(row)` with stable ids, and reuse
   `formatSseFrame` / `SSE_PING` from `steps.ts`.
3. Validate the token, 404 before streaming, then build the stream around one
   `cleanup()` wired to both `request.signal` and `cancel()`.
4. Seed the client from the server render and stream only when not finished.

## Tests

- `src/lib/bookings/__tests__/steps.unit.test.ts`: event order and subsets,
  `Last-Event-ID` filtering, frame format.
- `src/app/api/bookings/[token]/events/__tests__/route.unit.test.ts`: 404s,
  headers, frames across polls, abort stops polling, timeout, ping, poll error.
  Fake timers drive time.
- `ConfirmationTimeline.browser.test.tsx`: a stubbed `EventSource`.
- `e2e/booking-confirmation-timeline.integration.spec.ts`: seeds a row, updates
  it, and sees the page change with no reload. Runs in the ADW test phase only,
  not in CI.

## Known gap

When `/api/bookings/direct` confirms the booking first (the guest's redirect
beats the webhook, or the Stripe-fallback insert runs), the webhook's
`update ... where status = 'pending'` matches nothing, its fallback insert hits
the `stripe_session_id` unique constraint, and it skips both emails. That is
pre-existing behaviour; this feature only makes it visible: the timeline stops
at `Booking confirmed` and then shows the "email will follow" line, which in
that case is not true. The fix (the webhook treating "already confirmed by
`direct`" as confirmed and still sending the emails, idempotently via these
timestamps) changes payment-adjacent behaviour and belongs in its own issue.
