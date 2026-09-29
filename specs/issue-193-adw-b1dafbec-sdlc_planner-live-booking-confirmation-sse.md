# Feature: Live booking confirmation via Server-Sent Events

## Metadata

issue_number: `193`
adw_id: `b1dafbec`
issue_json: `{"number":193,"title":"website: live booking confirmation via Server-Sent Events — the page shows payment received, booking confirmed, email sent as they happen"}`

## Feature Description

After Stripe Checkout the guest lands on `/booking/confirmation?session=<stripe session id>`. Today that page renders one snapshot of the booking and states "A confirmation email has been sent to <email>" whether or not the Stripe webhook has actually sent it yet. The webhook's work (confirming the row, emailing the guest, notifying the owner) happens on its own schedule, often a few seconds after the page loaded, and none of those steps is recorded anywhere.

This feature makes those steps observable and shows them live:

1. The `bookings` table gains three nullable timestamps (`confirmed_at`, `guest_email_sent_at`, `owner_email_sent_at`) which the webhook writes as each step succeeds.
2. A new streaming route `GET /api/bookings/[token]/events` (token = `bookings.access_token`) emits Server-Sent Events `payment_received`, `confirmed`, `guest_email_sent`, `owner_email_sent`, `done` as each becomes true, polling the row once a second, bounded to 90 s.
3. A `"use client"` island `ConfirmationTimeline` on the confirmation page renders the steps already true at render time and appends the rest as the stream reports them: `Payment received`, `Booking confirmed`, `Confirmation sent to <email>`, `We have been notified`.

## User Story

As a guest who has just paid for a stay
I want to see payment, confirmation and the confirmation email happen on the page as they happen
So that I know my booking went through and the email is on its way, without refreshing

## Problem Statement

The confirmation page is a frozen snapshot of a process that is still running. A guest who arrives before the webhook sees a claim about an email that may not have been sent yet, and nothing updates until they refresh. The database has no per-step timestamps, so the steps cannot be observed at all.

## Solution Statement

Record each step in the database (migration plus webhook writes), derive the ordered list of events from a row with one pure function (`src/lib/bookings/steps.ts`), and serve that list over a short-lived SSE stream that polls the row with the admin client every second. The page's client island seeds its lines from the server render, so it works without JavaScript, and opens a browser `EventSource` only when the booking is not already fully done. No Supabase Realtime, no WebSockets, no new infrastructure, no new dependency.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - Repo conventions (yarn only, conventional commits, no `Co-Authored-By`, shared Supabase never reset).
- `apps/website/AGENTS.md` - Read Next docs in `node_modules/next/dist/docs/` first, Zod at API boundaries, server components by default, which test layers gate (unit + browser gate; `e2e/` does not run in CI).
- `apps/website/ENGINEERING.md` - Booking persistence and test-layer background.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Route handlers own DB access; pages fetch through them. `PageProps` / route typing.
- `apps/website/app_docs/data-fetching-client.md` - Why the client island must not query Supabase itself (it only talks to the stream route).
- `apps/website/app_docs/component-patterns-guide.md` - Render the four step lines from data, not four copies of JSX.
- `apps/website/app_docs/zod-validation-guide.md` - Validate the `token` path param and the `Last-Event-ID` header.
- `apps/website/app_docs/branding-guidelines.md` - House voice for the new copy (no bold, no em dashes, no emojis).
- `apps/website/app_docs/database/database-interaction-rules.md` - Read before writing the migration.
- `apps/website/app_docs/database/production-migrations.md` - The migration reaches production through the migrations workflow (dry-run on PR, push on merge to `master`).
- `apps/website/app_docs/testing/unit_test_spec_format.md` - Format for the new unit tests.
- `apps/website/app_docs/testing/component_test_spec_format.md` - Format for the new browser test.
- `apps/website/app_docs/testing/e2e_example.md` - Playwright spec conventions.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` - Route handler signature (`params` is a Promise) and the "Streaming" section using a Web `ReadableStream`. Note `cacheComponents: true` in `apps/website/next.config.ts`: do not add `export const dynamic` or `export const runtime`; a handler that reads `request` is already dynamic.
- `supabase/migrations/20260821120000_create_bookings_from_website.sql` - `bookings` shape, RLS posture (enabled, zero policies, anon/authenticated revoked), the `booking_availability` view whose column list must stay unchanged, the `updated_at` trigger. `stripe_session_id` and `access_token` are `unique`.
- `supabase/migrations/20260821160000_link_bookings_to_guest_contacts.sql` - Email lives on `guest_contacts`, not `bookings`.
- `apps/website/src/app/api/webhook/stripe/route.ts` - Sets `status = "confirmed"` (update at line ~141, insert fallback at ~158), sends guest email (~226) and owner email (~249). Gains the three timestamp writes. Already selects `access_token` from both the update and the insert, so the email-timestamp updates can key on it.
- `apps/website/src/app/api/webhook/stripe/__tests__/route.unit.test.ts` - Extend for the timestamp writes.
- `apps/website/src/app/api/bookings/direct/route.ts` - Recovery path (pending + Stripe says paid) updates `status = "confirmed"`; the Stripe fallback path inserts a confirmed row. Both must also set `confirmed_at`, otherwise a booking confirmed by this route never reaches the `confirmed` step. The `select` lists gain the three timestamp columns so the page gets the initial state.
- `apps/website/src/app/api/bookings/direct/__tests__/route.unit.test.ts` - Extend for `confirmed_at` on both confirm paths.
- `apps/website/src/app/(main)/booking/confirmation/page.tsx` - Integrates the timeline in place of the "A confirmation email has been sent to <bold email>" paragraph.
- `apps/website/src/app/api/ical/[room]/route.ts` and its `__tests__/route.unit.test.ts` - Existing pattern for a dynamic-segment route handler (`{ params }: { params: Promise<...> }`) and how the test passes `params`.
- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.browser.test.tsx` - Browser test pattern, including `vi.mock("posthog-js", ...)`.
- `apps/website/src/app/ui/WhatsAppLink.tsx` - Existing `posthog.capture` call style.
- `apps/website/src/lib/shared/supabase.ts` - `createAdminClient()` (service role, server only).
- `apps/website/e2e/booking-flow.integration.spec.ts` - Fixture seeding/cleanup pattern with `createAdminClient()` and a `guest_contacts` row.
- `apps/website/vitest.config.ts` - Unit tests match `src/**/*.unit.test.ts` (node); browser tests match `src/app/**`, `src/lib/**`, `src/ui/**` `*.browser.test.tsx`. No new `optimizeDeps` entry needed (`posthog-js`, `react`, `vitest-browser-react` already listed).
- `docs/conditional-docs.md` - Gets an entry for the new app doc.

### New Files

- `supabase/migrations/20260929120000_add_booking_step_timestamps.sql` - Adds the three columns, backfills pre-existing confirmed rows.
- `apps/website/src/lib/bookings/steps.ts` - Pure `computeEvents(row)`, `nextEvents(row, lastId)`, the step names/ids, and `formatSseFrame`. Shared by the route (server) and the timeline (client), so it must import nothing server-only.
- `apps/website/src/lib/bookings/__tests__/steps.unit.test.ts` - Unit tests for the above.
- `apps/website/src/app/api/bookings/[token]/events/route.ts` - The SSE route.
- `apps/website/src/app/api/bookings/[token]/events/__tests__/route.unit.test.ts` - Route tests with a mocked admin client and fake timers. (The issue says "beside it"; every other route test in this workspace lives in a sibling `__tests__/` directory, so it goes there.)
- `apps/website/src/app/(main)/booking/confirmation/ui/ConfirmationTimeline.tsx` - The client island.
- `apps/website/src/app/(main)/booking/confirmation/ui/ConfirmationTimeline.browser.test.tsx` - Browser test with a stubbed `EventSource`.
- `apps/website/e2e/booking-confirmation-timeline.integration.spec.ts` - Playwright spec: a seeded booking's timeline updates live when the row changes.
- `apps/website/app_docs/feature-b1dafbec-live-booking-confirmation-sse.md` - Feature doc (SSE route contract, the step model, how to add a live status page).

## Implementation Plan

### Phase 1: Foundation

Make the steps observable. Migration adds the three nullable `timestamptz` columns to `public.bookings` (no RLS, grant or view change). The webhook writes `confirmed_at` in the same update/insert that sets `status = "confirmed"`, and each email timestamp immediately after its send succeeds. The `direct` route's two confirm paths also set `confirmed_at`, and its selects return the timestamps. Then the pure step model in `src/lib/bookings/steps.ts`, unit-tested.

### Phase 2: Core Implementation

The SSE route handler: validate the token, look the row up (unknown → 404 JSON, before any stream), then return a `ReadableStream` that writes the events already true (above `Last-Event-ID`), polls every 1 s and writes only new events, pings every 15 s, and ends on `done`, on `timeout` at 90 s, on a poll error (`event: error`), or on client abort / stream cancel, with every timer cleared in one `cleanup()`.

### Phase 3: Integration

`ConfirmationTimeline` client island on the confirmation page, seeded from the server-rendered row, opening an `EventSource` only when not already done and a token exists. Analytics event on `done`. Playwright spec proving live update end to end. Feature doc and `conditional-docs.md` entry.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs that apply

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/database/database-interaction-rules.md`, `apps/website/app_docs/database/production-migrations.md`, `apps/website/app_docs/branding-guidelines.md`, and the "Streaming" section of `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.

### 2. Migration: step timestamps

- Create `supabase/migrations/20260929120000_add_booking_step_timestamps.sql` (use a timestamp later than the newest existing migration, `20260926120000_...`):
  - `alter table public.bookings add column confirmed_at timestamptz, add column guest_email_sent_at timestamptz, add column owner_email_sent_at timestamptz;` (all nullable, no default).
  - Header comment: what each column means, who writes it (webhook; `direct` route writes `confirmed_at` on its recovery/fallback paths), that failures leave the email columns null, that RLS/grants are unchanged (service-role only) and `booking_availability` deliberately does not expose them.
  - Backfill for rows confirmed before this migration, so revisiting an old confirmation page renders the finished timeline statically instead of streaming for 90 s and showing the "taking longer" line: `update public.bookings set confirmed_at = updated_at, guest_email_sent_at = updated_at, owner_email_sent_at = updated_at where status = 'confirmed' and confirmed_at is null;` with a comment explaining the assumption (those rows went through the same webhook that sends both emails; the timing was simply not recorded). Do not touch `pending` or `cancelled` rows.
  - Do not alter `booking_availability`, policies or grants.
- Apply it to the shared local database without resetting: `yarn supabase migration up --local` from the repo root. Never `supabase db reset` / `yarn supabase:reset`.

### 3. Webhook writes the timestamps

- In `apps/website/src/app/api/webhook/stripe/route.ts`:
  - Pending-row update: `update({ status: "confirmed", payment_intent: paymentIntentId, confirmed_at: new Date().toISOString() })`.
  - Insert fallback: add `confirmed_at: new Date().toISOString()` next to `status: "confirmed"`.
  - After `sendBookingConfirmationEmail` resolves (inside the existing `try`, after `emailSpan?.setAttribute("email.sent", true)`), write `guest_email_sent_at` with `createAdminClient().from("bookings").update({ guest_email_sent_at: new Date().toISOString() }).eq("access_token", booking.access_token)`. Same for `owner_email_sent_at` after `sendBookingNotificationEmail`. Extract a small local helper (for example `markStep(accessToken, column)`) rather than duplicating the update.
  - A failed timestamp write must not change the webhook's outcome or retry behaviour: check the returned `error` and `captureException` it with a tag such as `"booking.step": column`; do not throw. A failed send leaves the timestamp null (it is inside the `try` after the send). Existing error handling is otherwise unchanged.
- Extend `apps/website/src/app/api/webhook/stripe/__tests__/route.unit.test.ts`:
  - The pending-row update payload includes `confirmed_at` (an ISO string).
  - The insert-fallback payload includes `confirmed_at`.
  - After both sends succeed, `update` is called with `{ guest_email_sent_at: <iso> }` and `{ owner_email_sent_at: <iso> }`, each keyed by `.eq("access_token", <token>)`.
  - When `sendBookingConfirmationEmail` rejects, no `guest_email_sent_at` update happens, and the owner email still sends and is stamped.
  - When the timestamp update returns an error, the webhook still responds `200 { received: true }`.

### 4. `direct` route sets `confirmed_at` and returns the timestamps

- In `apps/website/src/app/api/bookings/direct/route.ts`:
  - Recovery update: `update({ status: "confirmed", confirmed_at: new Date().toISOString() })`, and set `booking.confirmed_at` on the in-memory object alongside the existing `booking.status = "confirmed"`.
  - Stripe fallback insert: add `confirmed_at` to `bookingData`.
  - Add `confirmed_at, guest_email_sent_at, owner_email_sent_at` to both `select(...)` strings. Keep returning `access_token`.
- Extend `apps/website/src/app/api/bookings/direct/__tests__/route.unit.test.ts`: the recovery update payload includes `confirmed_at`, and the fallback insert payload includes it.

### 5. Pure step model: `src/lib/bookings/steps.ts`

- Export:
  - `BookingStepRow = { status: string; confirmed_at: string | null; guest_email_sent_at: string | null; owner_email_sent_at: string | null }`.
  - `BOOKING_STEPS = ["payment_received", "confirmed", "guest_email_sent", "owner_email_sent"] as const` and `type BookingStepName`. Ids are the 1-based index; `done` is id `5` (`BOOKING_STEPS.length + 1`). Export `type BookingEvent = { id: number; name: BookingStepName | "done" }`.
  - `computeEvents(row): BookingEvent[]` - ordered: `payment_received` if `status === "confirmed"` or `confirmed_at` is set (the synchronous Stripe check in the `direct` route writes `status = "confirmed"`, so "Stripe says paid" is observed through the row); `confirmed` if `confirmed_at`; `guest_email_sent` if `guest_email_sent_at`; `owner_email_sent` if `owner_email_sent_at`; then `done` only when all four steps are present. It is an ordered subset, not a prefix: a failed guest email leaves id 3 out while id 4 can still appear.
  - `nextEvents(row, lastId): BookingEvent[]` - `computeEvents(row).filter((e) => e.id > lastId)`.
  - `isDone(row): boolean` - convenience used by the page and the timeline.
  - `formatSseFrame({ id?, event, data }): string` - `id: <n>\n` (only when `id` is given) + `event: <name>\n` + `data: <JSON.stringify(data)>\n\n`. Also export `SSE_PING = ": ping\n\n"`.
- No server-only imports in this file: the client island imports it.
- Create `apps/website/src/lib/bookings/__tests__/steps.unit.test.ts` (cases in Testing Strategy).

### 6. SSE route: `src/app/api/bookings/[token]/events/route.ts`

- Signature: `export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> })`, following `api/ical/[room]/route.ts`. No `runtime`, `dynamic` or `Connection` header.
- Validate `token` with Zod (`z.string().regex(/^[0-9a-f]{64}$/)`, the shape of `encode(gen_random_bytes(32), 'hex')`); invalid → `404` JSON, same as unknown, without touching the database.
- Look up: `createAdminClient().from("bookings").select("status, confirmed_at, guest_email_sent_at, owner_email_sent_at").eq("access_token", token).in("status", ["pending", "confirmed"]).maybeSingle()`. No row → `NextResponse.json({ error: "Booking not found" }, { status: 404 })`. Query error → `500` JSON. Both happen before any stream is created. Never select or send the booking UUID, the Stripe session id or the email.
- Parse `Last-Event-ID` (`request.headers.get("last-event-id")`) with Zod `z.coerce.number().int().min(0).max(5)`; anything invalid → `0`.
- Build the stream with named constants `POLL_INTERVAL_MS = 1_000`, `PING_INTERVAL_MS = 15_000`, `STREAM_DEADLINE_MS = 90_000`:
  - `start(controller)`: write `nextEvents(initialRow, lastId)` immediately; advance `lastId` to the highest id written. If `done` was written, `cleanup()` and return.
  - Poll with a self-rescheduling `setTimeout` (not `setInterval`, so a slow query can never overlap the next one). Each tick: if closed, return; `select` the four columns by token; on error write `formatSseFrame({ event: "error", data: { message: "Could not read booking status" } })` then `cleanup()`; otherwise write `nextEvents(row, lastId)`, advance `lastId`, `cleanup()` after `done`, else schedule the next tick. Writes happen only when there is something new.
  - Ping: `setInterval` writing `SSE_PING` every 15 s.
  - Deadline: `setTimeout` at 90 s writing `formatSseFrame({ event: "timeout", data: {} })` then `cleanup()`.
  - `timeout` and `error` carry no `id`, so they never move the client's `Last-Event-ID`.
  - `cleanup()` is idempotent: sets a `closed` flag, clears the poll timeout, ping interval and deadline, removes the abort listener, and calls `controller.close()` inside a `try` (it may already be closed/errored).
  - `request.signal.addEventListener("abort", cleanup)` (and handle `request.signal.aborted` already true); also call `cleanup` from the stream's `cancel()`. After abort nothing more is written and the database is not polled again.
  - Guard `enqueue` with the `closed` flag so a poll that resolves after abort writes nothing.
- Response: `new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } })`.
- Wrap the lookup in a Sentry `startSpan` named `api.bookings.events` like the neighbouring routes, but keep per-tick polling out of spans (a span per second for 90 s is noise).
- Create `__tests__/route.unit.test.ts` (cases in Testing Strategy). Mock `@/lib/shared/supabase` (`createAdminClient: () => ({ from: mockFrom })`) with a chain returning queued rows, and `@sentry/nextjs` as the neighbouring tests do. Read the body via `response.body!.getReader()` and a `TextDecoder`, driving time with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`.
- Negative check (required by the issue): temporarily delete the `request.signal` abort listener and the `cancel()` hook, run the "client abort stops polling" test, confirm it fails, then restore them and confirm it passes. Record in the PR description that this was tried and reverted.

### 7. Client island: `ConfirmationTimeline.tsx`

- `apps/website/src/app/(main)/booking/confirmation/ui/ConfirmationTimeline.tsx`, `"use client"`.
- Props: `token: string | null`, `email: string | null`, `initial: BookingStepRow`.
- State: the set of step names seen, seeded from `computeEvents(initial)`, plus a `timedOut` flag. Render an `<ol aria-live="polite" data-testid="confirmation-timeline">` of the steps seen, in `BOOKING_STEPS` order, from one label map (data, not four JSX copies):
  - `payment_received` → `Payment received`
  - `confirmed` → `Booking confirmed`
  - `guest_email_sent` → `Confirmation sent to {email}` (plain text, no bold; if `email` is null, `Confirmation sent`)
  - `owner_email_sent` → `We have been notified`
  - when `timedOut`: a final `<p>` `This is taking longer than usual. Your booking is safe; the email will follow.`
  - Put the label map and the timeout string in the component file as constants so the browser test and e2e spec can import them.
- Streaming: only if `token` is set and `!isDone(initial)`. In a `useEffect` (this subscribes to an external system, which is what an effect is for), open `new EventSource(\`/api/bookings/${token}/events\`)`, and:
  - for each of the four step names and `done`, `addEventListener(name, ...)` adding the name to the set (idempotent, so the server re-sending steps already seeded on the first connection is harmless);
  - on `done`: `posthog.capture("booking_confirmation_stream_completed", { steps, seconds })` once (guard with a ref), where `steps` is the number of steps seen and `seconds` is whole seconds since the effect opened the stream; then `close()`;
  - on `timeout`: set `timedOut`, `close()`;
  - on `error`: if the event is a `MessageEvent` (the server's `event: error`), `close()`. A plain connection `error` is left to the browser's auto-reconnect, which sends `Last-Event-ID`; if `readyState === EventSource.CLOSED` (for example a 404) there is nothing to do.
  - cleanup: `close()` on unmount.
- When not streaming, render the static list only (no `EventSource`, no analytics).
- The component renders on the server too, so the seeded lines are in the HTML without JavaScript.

### 8. Integrate into the confirmation page

- In `apps/website/src/app/(main)/booking/confirmation/page.tsx`:
  - Extend `BookingData` with `confirmed_at`, `guest_email_sent_at`, `owner_email_sent_at` (`string | null`), and make `access_token` optional, because the `direct` route's "insert failed, return Stripe data" branch has no token (the timeline then renders statically).
  - Replace the `<div className="pt-4 text-secondary">A confirmation email has been sent to <span className="font-bold">…</span></div>` block with `<ConfirmationTimeline token={booking.access_token ?? null} email={booking.email} initial={{ status: booking.status, confirmed_at: booking.confirmed_at ?? null, guest_email_sent_at: booking.guest_email_sent_at ?? null, owner_email_sent_at: booking.owner_email_sent_at ?? null }} />`, keeping the `pt-4 text-secondary` spacing on the wrapper.
  - Everything else (heading, `generateMetadata`, `direct` fetch, `blogReturn`, rendering mode) stays as it is.

### 9. Browser test: `ConfirmationTimeline.browser.test.tsx`

- Pattern from `GuardedBookingEngine.browser.test.tsx`; `vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))`.
- Stub `EventSource` with `vi.stubGlobal` using a small fake class that records instances, supports `addEventListener`, exposes `emit(name, init?)` and tracks `close()`. Cases in Testing Strategy.

### 10. Playwright spec: `e2e/booking-confirmation-timeline.integration.spec.ts`

- Model on `booking-flow.integration.spec.ts`. Seed with `createAdminClient()`:
  - a `guest_contacts` row with a random phone/email (as the conflict test does),
  - a `bookings` row: `status: "confirmed"`, `confirmed_at: now`, email timestamps null, `stripe_session_id: cs_test_e2e_timeline_<uuid>`, dates far in the future (+400 days) so it cannot collide with other specs' room1 windows, `select("id, access_token")`.
  - Because the row is already `confirmed`, the `direct` route never calls Stripe.
- Test "timeline updates live as the webhook's steps land":
  1. `page.goto(\`/booking/confirmation?session=${sessionId}\`)`.
  2. Expect `Payment received` and `Booking confirmed` visible; `Confirmation sent to` not visible.
  3. Update the row: `guest_email_sent_at: now`. Expect `Confirmation sent to <email>` visible without reloading (default expect timeout covers the 1 s poll).
  4. Update: `owner_email_sent_at: now`. Expect `We have been notified` visible.
- Test "a finished booking renders statically and opens no stream": seed all three timestamps; listen with `page.on("request")` for `/api/bookings/` + `/events`; after load, expect all four lines and zero stream requests.
- Test "unknown token returns 404": `request.get("/api/bookings/" + "0".repeat(64) + "/events")` → status 404.
- Clean up both rows in `finally`, as the existing spec does.
- This spec runs in the ADW test phase (`yarn workspace website test:integration`), not in CI.

### 11. Documentation

- Create `apps/website/app_docs/feature-b1dafbec-live-booking-confirmation-sse.md`: the three columns and who writes them; the step model and ids; the route contract (headers, framing, ping, 90 s bound, `Last-Event-ID`, 404 before streaming, why polling rather than Realtime); the client rules (seed from server render, stream only when not done, close on `done`/`timeout`/server `error`, native errors auto-reconnect); the analytics event; how to reuse the pattern for another live status page (pure `computeEvents` + `formatSseFrame` + one `cleanup()`); the known gap in Notes below.
- Add an entry to `docs/conditional-docs.md` under `apps/website`, with conditions: "When adding a live status page or an SSE route"; "When changing the booking confirmation page, the Stripe webhook's confirm/email steps, or the `bookings` step timestamps".
- Link the doc from `apps/website/ENGINEERING.md`'s booking persistence section in one line.

### 12. Validation

- Run every command in `Validation Commands`. Fix anything that fails.

## Testing Strategy

### Unit Tests

`src/lib/bookings/__tests__/steps.unit.test.ts`:

- Pending row, all null → `[]`.
- `status: "confirmed"`, all null → `[payment_received#1]`.
- Confirmed + `confirmed_at` → ids `[1, 2]`.
- Confirmed + `confirmed_at` + guest → `[1, 2, 3]`.
- Confirmed + `confirmed_at` + owner only (guest failed) → `[1, 2, 4]`, no `done`.
- All set → `[1, 2, 3, 4, 5]` with names in order, last is `done`.
- Pending with `confirmed_at` set → `payment_received` still emitted (either signal suffices).
- `nextEvents(allSet, 2)` → ids `[3, 4, 5]`; `nextEvents(allSet, 5)` → `[]`; `nextEvents(row, 0)` equals `computeEvents(row)`.
- `formatSseFrame({ id: 3, event: "guest_email_sent", data: {} })` === `"id: 3\nevent: guest_email_sent\ndata: {}\n\n"`; without `id` there is no `id:` line.

`src/app/api/bookings/[token]/events/__tests__/route.unit.test.ts` (fake timers, mocked admin client):

- Unknown token (lookup returns `null`) → `404`, JSON body, `Content-Type` is not `text/event-stream`.
- Malformed token (`"abc"`) → `404` and the admin client is never called.
- Headers on success: `text/event-stream; charset=utf-8`, `no-cache, no-transform`, `X-Accel-Buffering: no`, and no `Connection` header.
- Flip across polls: initial lookup pending/all null; poll 1 confirmed + `confirmed_at`; poll 2 + guest; poll 3 + owner. The concatenated body is exactly the frames `payment_received` (1), `confirmed` (2), `guest_email_sent` (3), `owner_email_sent` (4), `done` (5), each ending in `\n\n`, and the stream then closes (`reader.read()` resolves `done: true`).
- No-change polls write nothing (body unchanged between two ticks with the same row).
- `Last-Event-ID: 2` with an all-set row → only ids 3, 4, 5.
- Client abort: create the request with an `AbortController` signal, read the first frame, `abort()`, advance timers 5 s; the `from` mock's call count does not increase after the abort.
- Timeout: row never changes; advance 90 s → body ends with `event: timeout\ndata: {}\n\n`, the stream closes, and advancing further causes no more polls.
- Ping: advance 15 s with no change → body contains `: ping\n\n`.
- Poll error: a tick returns `{ error }` → `event: error\ndata: {"message":"Could not read booking status"}\n\n`, then close, then no more polls.

Existing route tests extended (webhook, `direct`), as listed in tasks 3 and 4.

### Test Coverage

- `src/lib/bookings/__tests__/steps.unit.test.ts` (`*.unit.test.ts`) - catches a wrong event order, a missing or extra step for any null/set combination, `done` emitted early, `Last-Event-ID` filtering off by one, and malformed SSE framing. Nothing covers these today because the module does not exist.
- `src/app/api/bookings/[token]/events/__tests__/route.unit.test.ts` (`*.unit.test.ts`) - catches a 404 that streams, wrong headers, duplicate or missing frames across polls, `Last-Event-ID` ignored, leaked polling after client abort (verified to fail with the abort handling removed), and an unbounded stream (no 90 s timeout).
- `src/app/api/webhook/stripe/__tests__/route.unit.test.ts` (extended, `*.unit.test.ts`) - catches the webhook not recording `confirmed_at` or the email timestamps, stamping an email that failed, or a timestamp write failure changing the webhook's response.
- `src/app/api/bookings/direct/__tests__/route.unit.test.ts` (extended, `*.unit.test.ts`) - catches a booking confirmed by the recovery/fallback path that never gets `confirmed_at`, which would leave the timeline stuck until timeout.
- `src/app/(main)/booking/confirmation/ui/ConfirmationTimeline.browser.test.tsx` (`*.browser.test.tsx`) - catches lines appearing out of order or duplicated, the `EventSource` not closing on `done`/`timeout`/server error or unmount, a stream opened for an already-finished booking, the timeout copy missing, and the analytics event firing zero or more than one time.
- `apps/website/e2e/booking-confirmation-timeline.integration.spec.ts` (`e2e/*.spec.ts`) - catches the whole chain failing in a real browser against the real route and the shared database: a DB change must appear on the page with no reload. Runs in the ADW test phase only, not CI, which is why the gating coverage lives in the two layers above.

Browser test cases (`ConfirmationTimeline.browser.test.tsx`):

- Initial `{ status: "confirmed", confirmed_at: set }`: renders `Payment received`, `Booking confirmed`; one `EventSource` opened at `/api/bookings/<token>/events`.
- Emitting `guest_email_sent` then `owner_email_sent` then `done` appends `Confirmation sent to guest@example.com` and `We have been notified` in that order; `close()` called; `posthog.capture` called once with `booking_confirmation_stream_completed` and `{ steps: 4, seconds: <number> }`.
- Re-emitting an already-seeded step (`confirmed`) does not duplicate the line.
- `timeout` → shows the timeout sentence and closes.
- Server `error` (a `MessageEvent`) → closes; a plain `Event("error")` does not close.
- All four timestamps set in `initial` → all four lines, no `EventSource` constructed.
- `token: null` → static lines, no `EventSource`.
- Unmount → `close()` called.

### Edge Cases

- Guest email send fails: `guest_email_sent_at` stays null, `owner_email_sent` still appears, `done` never comes, and the stream ends with `timeout` at 90 s.
- Guest arrives before the webhook: the `direct` route's Stripe check recovers the row to `confirmed` with `confirmed_at`, so `payment_received` and `confirmed` render at once. See the known gap in Notes for what the webhook then does.
- Reload mid-stream: the page re-renders from the current row and opens a new stream. The server re-sends only what the client does not have (on auto-reconnect via `Last-Event-ID`; on a fresh load the client dedupes).
- Network blip: the browser auto-reconnects with `Last-Event-ID`; the server resumes above it, and the 90 s budget restarts for that connection. That is acceptable because the client closes on `timeout`.
- Old bookings from before the migration: backfilled, so they render statically.
- `direct` route "insert failed, return Stripe data" branch: no `access_token`, so the timeline renders statically.
- Malformed or wrong-length token, cancelled booking: `404`, no stream.
- Abort racing an in-flight poll: the resolved poll writes nothing (`closed` guard) and schedules nothing.
- `Last-Event-ID` non-numeric, negative or above 5: treated as 0 (or clamped), never throws.

## Acceptance Criteria

- `public.bookings` has nullable `confirmed_at`, `guest_email_sent_at`, `owner_email_sent_at`; RLS, grants and `booking_availability` are unchanged; pre-existing confirmed rows are backfilled.
- The webhook sets `confirmed_at` in the same update/insert that sets `status = "confirmed"`, and stamps each email only after its send succeeds. Webhook responses and retry behaviour are unchanged.
- The `direct` route sets `confirmed_at` on both paths where it confirms a booking, returns the three timestamps, and still returns `access_token`.
- `GET /api/bookings/<access_token>/events`: 404 before streaming for an unknown or malformed token; the three required headers; frames `id: n\nevent: name\ndata: json\n\n` with ids 1 to 5 in step order; `: ping` every 15 s; `timeout` at 90 s; `event: error` then close on a poll failure; `Last-Event-ID` honoured; no polling after abort; no `Connection` header; no `runtime = "edge"`.
- The confirmation page shows the step lines with the exact copy, appends new ones live without a refresh, shows the timeout sentence when the stream times out, opens no stream when the booking is already done, and shows the seeded lines without JavaScript.
- `booking_confirmation_stream_completed { steps, seconds }` fires exactly once on `done` and nothing per event.
- New copy has no bold, no em dashes and no emojis. The old bold email paragraph is gone.
- All validation commands pass. The abort negative check was tried and reverted, and the PR says so.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn supabase migration up --local` - Applies the new migration to the shared local database without a reset (it must apply cleanly; never `db reset`)
- `yarn supabase db lint --local` - The migrated schema has no lint errors
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, including the new step, route and timeline tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and the build output lists `/api/bookings/[token]/events` as a dynamic route
- `yarn workspace website vitest run --project unit src/app/api/bookings` - Targeted re-run of the SSE and `direct` route tests (run once more after the negative abort check is reverted)

## Notes

- No new dependency. `EventSource`, `ReadableStream`, `TextEncoder` and `AbortSignal` are platform APIs; `posthog-js` and `zod` are already installed.
- **Known gap, raise with the owner before merge (payment-adjacent, outside this issue's scope).** When the `direct` route confirms the booking first (the guest's redirect wins the race against the webhook, or the Stripe fallback insert path runs), the webhook's `update ... where status = 'pending'` matches nothing, its fallback `insert` hits the `stripe_session_id` unique constraint (`23505`), it returns `null`, and it skips both emails entirely. That is existing behaviour: the guest silently gets no confirmation email in that race. This feature makes it visible. The timeline stops at `Booking confirmed` and then shows "the email will follow", which in that case is not true. The fix (make the webhook treat "already confirmed by `direct`" as confirmed and still send the emails, idempotently via the new timestamps) changes webhook behaviour and belongs in its own issue. Recommend opening it alongside this PR.
- The backfill in the migration marks pre-existing confirmed rows as emailed. That is an assumption about history (those rows went through the same webhook), made so old confirmation links do not stream for 90 s. If the owner prefers only `confirmed_at` to be backfilled, drop the two email columns from the `update`; old links would then show the timeout line.
- The migration reaches production via `.github/workflows/migrations.yml` (dry-run on the PR, `supabase db push` on merge to `master`); see `apps/website/app_docs/database/production-migrations.md`. The code reads the new columns, so the migration must be applied before or with the deploy. The workflow does this on merge.
- Polling costs at most about 90 small indexed `select`s (by `access_token`, which is `unique`) per open confirmation page, and usually a handful, because the webhook finishes in seconds. Supabase Realtime was ruled out by the issue.
- Vercel Fluid compute allows 300 s; the 90 s deadline keeps each invocation well inside it, so no `maxDuration` export is needed.
- Manual check on the preview (owner, Stripe test mode, per the issue's `adw:hold`): complete a checkout and watch the lines appear; reload mid-way; `curl -N <preview>/api/bookings/<token>/events` to see raw frames and `: ping`.
- No browser surface in `telegram-router`, `guest-communication-agent` or `packages/pricing` is touched; this is `apps/website` plus one shared migration.
