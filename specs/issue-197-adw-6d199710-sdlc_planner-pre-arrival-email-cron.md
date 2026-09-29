# Feature: Pre-arrival email 48 hours before check-in (daily Vercel cron, idempotent)

## Metadata

issue_number: `197`
adw_id: `6d199710`
issue_json: `{"number":197,"title":"website: pre-arrival email 48 hours before check-in (daily Vercel cron, idempotent), with name, check-in from 3 pm, check-out by 11 am, address and parking, no prices"}`

## Feature Description

Every guest with a confirmed booking is promised an email 48 hours before arrival with the address, parking and arrival details (the promise is printed in `BookingConfirmationEmail.tsx`). Nothing sends it today; the owner sends it by hand. This feature adds:

- a nullable `pre_arrival_email_sent_at timestamptz` column on `public.bookings`, which records that a booking's pre-arrival email went out;
- a pure selection module (`src/lib/bookings/pre-arrival.ts`) that decides which bookings are due, using reconciliation (check-in on today+1 or today+2, UTC calendar days), not an exact 48 h instant;
- a pure copy module (`src/lib/bookings/pre-arrival-email.ts`) holding the subject, every sentence and the plain-text builder, so the HTML template and the `text:` alternative cannot drift apart;
- a React email template `src/app/emails/PreArrivalEmail.tsx` in the same inline style as `BookingConfirmationEmail`;
- `sendPreArrivalEmail` in `src/lib/resend.ts` (from `RESEND_FROM_EMAIL`, `bcc` and `replyTo` `ADMIN_NOTIFICATION_EMAIL`);
- a cron route `GET /api/cron/pre-arrival` guarded by `Authorization: Bearer ${CRON_SECRET}`, with `?dryRun=1`, a claim-then-send loop that is safe under duplicate invocations, and a `{ sent, skipped, failed }` JSON summary;
- a daily Vercel Cron entry in `apps/website/vercel.json` (`0 7 * * *`).

The email contains the guest's first name, check-in day "from 3 pm" and how the meeting works, check-out day "by 11 am", the room, the address with the blue gate and map link, parking guidance and a WhatsApp contact. It contains no prices, tourist tax, totals or confirmation URL.

## User Story

As a guest with a confirmed stay at issebya.homes
I want to receive one email two days before my arrival with the address, parking and check-in arrangements
So that I can arrive without having to ask the host for the basics, and the owner no longer has to send it by hand

## Problem Statement

The confirmation email tells guests "48 hours before your arrival, we'll send you the exact address, parking details, and all essential information for your stay", but no code sends that email and the repo has no scheduler. Prod has a confirmed booking arriving 2026-10-01 whose email the owner sent manually. Vercel Cron on Hobby runs at most once a day, somewhere within the scheduled hour, is best effort (runs can be missed or duplicated) and never retries, so a naive "send to bookings exactly 48 h away" job would miss guests or email them twice.

## Solution Statement

Run a daily Vercel Cron against a route handler that reconciles state rather than hitting an instant:

1. **Select**: confirmed bookings whose `pre_arrival_email_sent_at is null` and whose `check_in` is between `today` and `today + 2` (UTC calendar day strings built with `toCalendarDay` / `fromCalendarDay` + `date-fns` `addDays`). The pure `selectPreArrivalCandidates(rows, today)` splits them into `candidates` (check-in today+1 or today+2) and `tooLate` (check-in today or earlier; logged and reported as skipped, never sent). A missed run is caught up the next day; a booking made inside the window still gets the email.
2. **Claim before send**: for each candidate, `update bookings set pre_arrival_email_sent_at = now() where id = $1 and pre_arrival_email_sent_at is null returning id`. Zero rows means another invocation already took it: skip. This is what makes two concurrent cron deliveries send exactly once.
3. **Send**, and on failure **release the claim** (`set pre_arrival_email_sent_at = null where id = $1`), `captureException` to Sentry, and list it under `failed`, so the next day's run retries.
4. **Report** `{ sent, skipped, failed }` as JSON and log one `console.log` line per booking with the booking id only, never the email.

Auth fails closed: `CRON_SECRET` unset returns 500 with a clear message; any `Authorization` header other than exactly `Bearer ${CRON_SECRET}` returns 401. `?dryRun=1` (still authenticated) returns candidates with masked emails and sends/claims nothing.

Email copy lives once, in `src/lib/bookings/pre-arrival-email.ts`, and is consumed by both the React template and the plain-text builder. The WhatsApp number/URL currently hardcoded inside the client component `src/app/ui/WhatsAppLink.tsx` is lifted into `src/lib/site.ts` constants so the email (server-only, no `posthog-js`) and the component share one source.

## Relevant Files

Use these files to implement the feature:

- `README.md` - repo overview; which app owns what.
- `AGENTS.md` - repo conventions; gets one line that crons live in each app's `vercel.json` and run only on production.
- `docs/conditional-docs.md` - gets a new entry for this feature's app_doc ("when adding a scheduled job or a guest email").
- `apps/website/AGENTS.md` - website rules: calendar days are `"yyyy-MM-dd"` strings, only `toCalendarDay`/`fromCalendarDay` convert; which test layers gate (unit + browser gate, `e2e/` does not run in CI).
- `apps/website/ENGINEERING.md` - booking persistence background and test-layer notes.
- `apps/website/app_docs/database/database-interaction-rules.md` - migration rules; admin code uses the table directly via `createAdminClient()`.
- `apps/website/app_docs/database/production-migrations.md` - how the migration reaches prod (dry-run on PR into develop, apply on promotion).
- `apps/website/app_docs/environment-setup.md` - env var table; add `CRON_SECRET`, `RESEND_FROM_EMAIL`, `ADMIN_NOTIFICATION_EMAIL` rows as needed. Never read `.env*` files.
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy voice (no em dashes, no emojis, no bold in copy).
- `apps/website/app_docs/nextjs-patterns-guide.md` - route handler conventions.
- `apps/website/app_docs/dynamic-url-construction.md` - the email must not build a base URL; it contains no site links at all (only Google Maps and wa.me), so no origin is needed.
- `apps/website/app_docs/testing/unit_test_spec_format.md` - unit test format.
- `apps/website/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (or the repo-root `node_modules/next/dist/docs/...` equivalent) - read before writing the route handler; `next.config.ts` has `cacheComponents: true`, so confirm the GET handler is dynamic (it reads `request.headers`, which opts it out of prerendering).
- `apps/website/vercel.json` - add `crons`, keep `ignoreCommand`.
- `apps/website/src/lib/resend.ts` - add `sendPreArrivalEmail`; reuse the private `formatRoomType`; follow `sendWishlistConfirmationEmail`'s pattern of throwing on Resend `{ error }`.
- `apps/website/src/app/emails/BookingConfirmationEmail.tsx` - style reference (inline styles, `fromCalendarDay`-based date formatting).
- `apps/website/src/lib/date-utils.ts` - `toCalendarDay` / `fromCalendarDay`, the only allowed calendar-day conversions.
- `apps/website/src/lib/shared/supabase.ts` - `createAdminClient()` (service role, bypasses RLS).
- `apps/website/src/lib/site.ts` - add `WHATSAPP_URL` and `WHATSAPP_DISPLAY_NUMBER` constants.
- `apps/website/src/app/ui/WhatsAppLink.tsx` - switch to the new constants (no behaviour change).
- `apps/website/src/lib/__tests__/resend.unit.test.ts` - existing Resend mock pattern (`vi.mock("resend", ...)`, `vi.stubEnv`); extend with `sendPreArrivalEmail` cases.
- `apps/website/src/app/api/ical/[room]/__tests__/route.unit.test.ts` - route-test pattern: mock `@/lib/shared/supabase` and `@sentry/nextjs`, warm the route import in `beforeAll` with a 60 s timeout.
- `apps/website/src/app/api/ical/[room]/route.ts` - pattern for Sentry `captureException` with tags in a route nobody watches.
- `supabase/migrations/20260821160000_link_bookings_to_guest_contacts.sql` - confirms `bookings` no longer has `email`/`guest_name`; they live on `guest_contacts` via non-null `guest_contact_id`.
- `supabase/migrations/20260926120000_add_shop_wishlist_unsubscribe.sql` - header-comment style for a migration.
- `.github/workflows/migrations.yml` - the "fail closed when a secret is unset" precedent (`SUPABASE_DB_URL`) the route mirrors.
- `knip.json` - website entries already cover `src/**/*.unit.test.ts`; no change expected, but new exports must all be used.

### New Files

- `supabase/migrations/20260929120000_add_pre_arrival_email_sent_at_to_bookings.sql` - the column.
- `apps/website/src/lib/bookings/pre-arrival.ts` - pure selection and helpers: types, `selectPreArrivalCandidates`, `firstName`, `maskEmail`, `preArrivalWindow(today)`.
- `apps/website/src/lib/bookings/pre-arrival-email.ts` - pure copy: constants for every line, `formatArrivalDate`, `preArrivalEmailSubject`, `preArrivalEmailText`.
- `apps/website/src/lib/bookings/__tests__/pre-arrival.unit.test.ts` - selection + `firstName` + `maskEmail` tests.
- `apps/website/src/lib/bookings/__tests__/pre-arrival-email.unit.test.ts` - plain-text body and rendered HTML content tests.
- `apps/website/src/app/emails/PreArrivalEmail.tsx` - React template.
- `apps/website/src/app/api/cron/pre-arrival/route.ts` - cron route handler.
- `apps/website/src/app/api/cron/pre-arrival/__tests__/route.unit.test.ts` - route tests with an in-memory fake of the Supabase query builder.
- `apps/website/app_docs/feature-6d199710-pre-arrival-email-cron.md` - feature doc (written by the document phase; listed so the conditional-docs entry has a target).

## Implementation Plan

### Phase 1: Foundation

- Migration adding `pre_arrival_email_sent_at timestamptz` (nullable) to `public.bookings`; RLS and grants unchanged. `booking_availability` is a view with an explicit column list, so it is unaffected.
- Lift the WhatsApp number/URL into `src/lib/site.ts`.
- Pure modules: selection (`pre-arrival.ts`) and copy (`pre-arrival-email.ts`), each with unit tests written alongside.

### Phase 2: Core Implementation

- `PreArrivalEmail.tsx` template rendering the copy constants with inline styles and links.
- `sendPreArrivalEmail` in `resend.ts`: `react` + `text` bodies, `bcc` and `replyTo` the owner, throws on Resend `{ error }` or missing env.
- Route handler: auth, dry run, query, classify, claim-then-send-or-release loop, Sentry, summary JSON.

### Phase 3: Integration

- `vercel.json` cron entry.
- Docs: `AGENTS.md` one-liner, `environment-setup.md` `CRON_SECRET` row, `.env.example` placeholder, `conditional-docs.md` entry.
- PR body must state the owner steps (see Notes).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the governing docs

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/database/database-interaction-rules.md`, `apps/website/app_docs/branding-guidelines.md`, `apps/website/app_docs/environment-setup.md` and the Next.js `route.md` doc in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`.

### 2. Migration

- Create `supabase/migrations/20260929120000_add_pre_arrival_email_sent_at_to_bookings.sql`. Header comment explains: set by the website's `/api/cron/pre-arrival` route with a conditional update (`where pre_arrival_email_sent_at is null`) before sending, reset to null if the send fails; null means "not yet sent". Body:
  ```sql
  alter table public.bookings add column pre_arrival_email_sent_at timestamptz;
  ```
  No RLS, policy, grant or index change (the candidate set is tiny: at most a handful of confirmed bookings in a three-day window).
- Apply to the shared local DB without a reset: `yarn supabase migration up` from the repo root. Never `supabase start` / `db reset`.

### 3. WhatsApp constants

- In `apps/website/src/lib/site.ts` add, with a one-line comment each:
  - `export const WHATSAPP_URL = "https://wa.me/351920742845";`
  - `export const WHATSAPP_DISPLAY_NUMBER = "+351 920 742 845";`
- Update `apps/website/src/app/ui/WhatsAppLink.tsx` to use them (`href={WHATSAPP_URL}`, text `WhatsApp ({WHATSAPP_DISPLAY_NUMBER})`). Rendered output is byte-identical.

### 4. Pure selection module `src/lib/bookings/pre-arrival.ts`

- File header comment: reconciliation, not "exactly 48 h"; why the window is today+1..today+2; why today is too late; the server runs in UTC on Vercel so `toCalendarDay(new Date())` is the UTC day there.
- Types:
  ```ts
  export type PreArrivalBookingRow = {
    id: string;
    room_type: string;
    check_in: string; // "yyyy-MM-dd"
    check_out: string; // "yyyy-MM-dd"
    status: string;
    pre_arrival_email_sent_at: string | null;
    guest_name: string | null;
    email: string | null;
  };
  ```
  (The route flattens the `guest_contacts(guest_name, email)` embed into this shape; PostgREST returns a many-to-one embed as an object, but normalise object-or-array defensively in the route.)
- `export function preArrivalWindow(today: string): { from: string; to: string }` returns `{ from: today, to: toCalendarDay(addDays(fromCalendarDay(today), 2)) }` (the route queries this range so too-late same-day bookings can be logged; unbounded past bookings are never fetched).
- `export function selectPreArrivalCandidates(rows, today): { candidates: PreArrivalBookingRow[]; tooLate: PreArrivalBookingRow[] }`:
  - Drop rows where `status !== "confirmed"` or `pre_arrival_email_sent_at !== null` (defence in depth; the query filters these too).
  - `check_in` equal to `today + 1` or `today + 2` → `candidates`. Compare `"yyyy-MM-dd"` strings computed via `toCalendarDay(addDays(fromCalendarDay(today), n))`; lexicographic comparison of that format is safe.
  - `check_in <= today` → `tooLate`.
  - Anything later than today+2 → neither.
- `export function firstName(guestName: string | null): string | null` → trims, splits on whitespace, returns the first word or `null` for null/empty/whitespace.
- `export function maskEmail(email: string): string` → e.g. `anna@example.com` → `a***@example.com`; no `@` → `***`. Used only by dry run.

### 5. Pure copy module `src/lib/bookings/pre-arrival-email.ts`

- Imports only `fromCalendarDay` and the `site.ts` WhatsApp constants, so it runs in the node pool.
- Constants (exact copy from the issue; no em dashes, no emojis, no bold):
  - `MAP_URL = "https://maps.app.goo.gl/3zBr4vAiyEWcszsm6"`
  - `PARKING_MAP_URL = "https://maps.app.goo.gl/75jxxiksPZyLixSA7"`
  - `INTRO_LINE = "Your stay is two days away, so here is everything for your arrival."`
  - `ROOM_LINE_TAIL = "ground floor, with its own bathroom. Living room, kitchen and terrace are shared."`
  - `ADDRESS_LINE = "Address: Rua do Lagarto 5, 2705-044 Almoçageme, Portugal. Enter through the blue gate."`
  - parking sentence split around the link: `"Parking: there is no private parking. Guests park along the main street, usually a few metres away"` + `(<link>).` + `"Please do not park next to the shop Amor Plat Terra."`
  - `CONTACT_LINE = "If anything changes, reply to this email or write to Sveta on WhatsApp."`
  - `SIGN_OFF = "See you soon,"`, `SIGNATURE = "issebya.homes"`
- `export function formatArrivalDate(day: string): string` → `fromCalendarDay(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })` (e.g. "Wednesday, 1 October"; verify the exact en-GB output in the test and adjust expectation, not the format options).
- `export function preArrivalEmailSubject()` → `"Your stay at issebya.homes is coming soon"` (fixed by issue #197's content contract).
- `export function greetingLine(guestName: string | null)` → `Hello <first>,` or `Hello,` (uses `firstName` from `pre-arrival.ts`).
- `export function checkInLine(checkIn)` → `` `Check-in: ${date}, from 3 pm. There is no self check-in: Sveta meets you at the house at the time you agree with her, so please reply with your expected arrival time.` ``
- `export function checkOutLine(checkOut)` → `` `Check-out: ${date}, by 11 am.` ``
- `export function roomLine(roomLabel)` → `` `Room: ${roomLabel}, ${ROOM_LINE_TAIL}` ``
- `export type PreArrivalEmailProps = { guestName: string | null; roomLabel: string; checkIn: string; checkOut: string }`
- `export function preArrivalEmailText(props): string` joins, with blank lines between paragraphs: greeting, intro, check-in, check-out, room, address line, `Map: ${MAP_URL}`, parking sentence with `(${PARKING_MAP_URL})`, contact line followed by `WhatsApp: ${WHATSAPP_DISPLAY_NUMBER}, ${WHATSAPP_URL}`, then `See you soon,` and `issebya.homes` on consecutive lines.
- Only export what the template, `resend.ts` and tests use (knip).

### 6. Template `src/app/emails/PreArrivalEmail.tsx`

- `export function PreArrivalEmail(props: PreArrivalEmailProps)` returning `<html>` with `<head><meta charSet="utf-8" /><title>{subject}</title></head>` and a `<body>` using the same inline body style as `BookingConfirmationEmail` (`fontFamily: "sans-serif"`, `color: "#111"`, `maxWidth: "600px"`, `margin: "0 auto"`, `padding: "24px"`).
- One `<p>` per line from the copy module, in the order listed in the issue. The address paragraph ends with a "View on the map" `<a href={MAP_URL}>`; the parking paragraph wraps "main street map" (or the URL) in `<a href={PARKING_MAP_URL}>` between the two sentence halves; "WhatsApp" in the contact line is an `<a href={WHATSAPP_URL}>` followed by `({WHATSAPP_DISPLAY_NUMBER})`. No `fontWeight: "bold"` anywhere, no heading in bold, no price, no button, no confirmation URL.
- Sign-off paragraph: `See you soon,<br />issebya.homes`.

### 7. `sendPreArrivalEmail` in `src/lib/resend.ts`

- Add a JSDoc explaining: guest pre-arrival email; owner in `bcc` so she sees what went out and in `replyTo` so replies reach her; throws on missing env or Resend `{ error }` so the cron route can release the claim and report.
- Signature: `sendPreArrivalEmail({ email, guestName, roomType, checkIn, checkOut }): Promise<void>`.
- Throw `Missing environment variable: RESEND_FROM_EMAIL` / `ADMIN_NOTIFICATION_EMAIL` if unset (the bcc is a contract, so a missing owner address is a failure, not a silent skip).
- `resend.emails.send({ from, to: email, bcc: adminEmail, replyTo: adminEmail, subject: preArrivalEmailSubject(), react: PreArrivalEmail(props), text: preArrivalEmailText(props) })` with `roomLabel = formatRoomType(roomType)`.
- On `{ error }` throw `Resend failed to send the pre-arrival email: ${error.message}`.

### 8. Route `src/app/api/cron/pre-arrival/route.ts`

- File header comment: who calls it (Vercel Cron, production only, GET, `Authorization: Bearer <CRON_SECRET>`), why reconciliation and claim-then-send, why logs carry only booking ids.
- `export async function GET(request: NextRequest)`:
  1. `const secret = process.env.CRON_SECRET;` if falsy → `500 { error: "CRON_SECRET is not set; refusing to run" }` (fail closed).
  2. `if (request.headers.get("authorization") !== \`Bearer ${secret}\`)`→`401 { error: "Unauthorized" }`.
  3. `const today = toCalendarDay(new Date()); const { from, to } = preArrivalWindow(today); const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";`
  4. Query with `createAdminClient()`:
     ```ts
     supabase
       .from("bookings")
       .select(
         "id, room_type, check_in, check_out, status, pre_arrival_email_sent_at, guest_contacts(guest_name, email)",
       )
       .eq("status", "confirmed")
       .is("pre_arrival_email_sent_at", null)
       .gte("check_in", from)
       .lte("check_in", to);
     ```
     On error: `console.error`, `captureException(error, { tags: { "cron.job": "pre-arrival", "db.operation": "select_candidates" } })`, `500 { error: "Failed to fetch bookings" }`.
  5. Flatten rows into `PreArrivalBookingRow` and run `selectPreArrivalCandidates(rows, today)`.
  6. For each `tooLate` row: `console.log(\`[cron/pre-arrival] booking ${id}: skipped, check-in ${check_in} is today or past\`)`and push`{ bookingId, checkIn, reason: "too_late" }`to`skipped`.
  7. Dry run: return `200 { dryRun: true, today, candidates: candidates.map(c => ({ bookingId: c.id, checkIn: c.check_in, email: c.email ? maskEmail(c.email) : null })), skipped }`. No update, no send.
  8. For each candidate, sequentially:
     - No `email` on the contact → skip `reason: "no_email"` and `captureException(new Error("Pre-arrival candidate has no email"), { tags: {...}, extra: { bookingId } })`; do not claim.
     - Claim: `.from("bookings").update({ pre_arrival_email_sent_at: new Date().toISOString() }).eq("id", id).is("pre_arrival_email_sent_at", null).select("id")`. On error → `failed` with Sentry. If `data.length === 0` → `skipped` with `reason: "already_claimed"`.
     - Send via `sendPreArrivalEmail`. Success → `sent` `{ bookingId, checkIn }`.
     - Failure → release: `.update({ pre_arrival_email_sent_at: null }).eq("id", id)`; `captureException(error, { tags: { "cron.job": "pre-arrival", "email.operation": "send_pre_arrival" }, extra: { bookingId } })`; if the release itself errors, `captureException` that too; push `failed` `{ bookingId, checkIn, error: message }`.
     - One `console.log` line per booking outcome with the booking id and outcome, never the email or name.
  9. Return `200 { sent, skipped, failed }`.
- Keep auth, query and loop readable; small local helpers inside the route file are fine. No `export const dynamic` unless the Next docs say it is needed under `cacheComponents` (reading `request.headers` already makes it dynamic).

### 9. `vercel.json` cron

- `apps/website/vercel.json` becomes:
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "ignoreCommand": "bash ../../scripts/vercel-ignore.sh",
    "crons": [{ "path": "/api/cron/pre-arrival", "schedule": "0 7 * * *" }]
  }
  ```

### 10. Unit tests: selection `src/lib/bookings/__tests__/pre-arrival.unit.test.ts`

- `today = "2026-09-29"`. Rows: confirmed on 09-30 and 10-01 (picked), confirmed on 10-02 (neither), confirmed on 09-29 and 09-28 (tooLate), pending and cancelled on 09-30 (neither), confirmed already-sent on 10-01 (neither).
- Month/year boundary: `today = "2026-12-31"` picks `2027-01-01` and `2027-01-02`.
- `preArrivalWindow("2026-09-29")` → `{ from: "2026-09-29", to: "2026-10-01" }`.
- `firstName`: `null` → `null`; `""`/`"  "` → `null`; `"Anna"` → `"Anna"`; `"  Anna  Maria Silva "` → `"Anna"`.
- `maskEmail`: `"anna@example.com"` → `"a***@example.com"`; never returns the full local part.

### 11. Unit tests: copy and template `src/lib/bookings/__tests__/pre-arrival-email.unit.test.ts`

- Props `{ guestName: "Anna Silva", roomLabel: "Room 1", checkIn: "2026-10-01", checkOut: "2026-10-04" }`.
- `preArrivalEmailSubject()` === `"Your stay at issebya.homes is coming soon"`.
- `preArrivalEmailText(props)` contains: `"Hello Anna,"`, the intro line, `"Check-in: Wednesday, 1 October, from 3 pm."`, `"Check-out: Saturday, 4 October, by 11 am."`, `"Room: Room 1, ground floor"`, `"Rua do Lagarto 5, 2705-044 Almoçageme, Portugal. Enter through the blue gate."`, both map URLs, `"Please do not park next to the shop Amor Plat Terra."`, the contact line, the WhatsApp URL, `"See you soon,"` and `"issebya.homes"`.
- With `guestName: null` the text starts with `"Hello,"`.
- Negative content: `text.toLowerCase()` does not contain `"tax"`, `"total"`, `"€"`, `"/booking/confirmation"`, or `"—"` (em dash).
- Render `PreArrivalEmail(props)` with `renderToStaticMarkup` from `react-dom/server` (call the component as a function so the file stays `.ts`) and assert the HTML contains the check-in and check-out lines, both map hrefs, the WhatsApp href, and does not contain `"€"`, `"tax"`, `"total"` or `"bold"`.

### 12. Unit tests: `sendPreArrivalEmail` in `src/lib/__tests__/resend.unit.test.ts`

- New `describe("sendPreArrivalEmail")` using the existing `mockSend` and `vi.stubEnv` pattern: asserts `from`, `to`, `bcc: "owner@example.com"`, `replyTo: "owner@example.com"`, the subject, that `text` equals `preArrivalEmailText(...)` for the same props, and that `react` is defined.
- Throws when Resend returns `{ error }`; throws when `ADMIN_NOTIFICATION_EMAIL` is unset and does not call `mockSend`.

### 13. Route tests `src/app/api/cron/pre-arrival/__tests__/route.unit.test.ts`

- Mocks: `@/lib/shared/supabase` → `createAdminClient: () => fake`, `@/lib/resend` → `sendPreArrivalEmail: mockSend`, `@sentry/nextjs` → `captureException: mockCapture`. Warm `await import("../route")` in `beforeAll` with `60_000` like the iCal route test. `vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T12:00:00Z"))` so `today` is `2026-09-29` in any runner timezone within ±11 h; `vi.stubEnv("CRON_SECRET", "test-secret-1234567890")`.
- **In-memory fake query builder** (the key design decision): a tiny `from(table)` returning a builder that records `select`/`update` plus `eq`, `is`, `gte`, `lte` filters and, when awaited (thenable), applies them to a shared in-memory `rows` array (each with a `guest_contacts` object). `update(...).select("id")` returns only rows that matched every recorded filter and mutates them. Resolve asynchronously (`await Promise.resolve()` / `setTimeout(0)`) so concurrent invocations interleave. Because the fake honours filters, a claim without `.is("pre_arrival_email_sent_at", null)` really does match twice, which is what makes the negative test meaningful. A `failNext` hook lets a test force a query `{ error }`.
- Cases:
  1. No `Authorization` header → 401, no DB call, no send.
  2. Wrong bearer (`Bearer nope`) → 401.
  3. `CRON_SECRET` unset (`vi.stubEnv("CRON_SECRET", "")`) → 500 with the clear message, no DB call.
  4. `?dryRun=1` with one candidate → 200, `candidates[0]` has `bookingId`, `checkIn` and a masked email (not the raw one), `mockSend` not called, row's `pre_arrival_email_sent_at` still null.
  5. Happy path: one confirmed booking on 10-01 → `sent` has it, `mockSend` called once with the contact's email/name, row now has a timestamp.
  6. Pending, cancelled, already-sent and 10-02 rows are not sent; a confirmed check-in-today row lands in `skipped` with `reason: "too_late"`.
  7. Claim returns 0 rows (pre-set a timestamp between select and claim via a fake hook, or pre-mark the row after select) → `skipped` with `reason: "already_claimed"`, no send.
  8. Send failure (`mockSend.mockRejectedValueOnce(new Error("boom"))`) → `failed` contains the booking, `mockCapture` called, row's `pre_arrival_email_sent_at` reset to `null`.
  9. **Concurrency / send once**: `await Promise.all([GET(req()), GET(req())])` over one candidate → `mockSend` called exactly once; one response has it in `sent`, the other in `skipped` (`already_claimed`).
  10. DB select error → 500, `mockCapture` called.
  11. Logging: spy on `console.log`; no logged argument contains the guest's email.
- **Negative check (do it, then revert)**: temporarily delete `.is("pre_arrival_email_sent_at", null)` from the claim in `route.ts`, run the route test, confirm case 9 fails (`mockSend` called twice), restore the line, re-run green. State in the PR/implementation report that this was tried and reverted.

### 14. Docs and env

- Root `AGENTS.md`, under repo-wide conventions or the Vercel bullets: one line, e.g. "Scheduled jobs are Vercel Cron entries in each app's own `vercel.json` (`crons`); they run only against the production deployment, never on previews or locally, so a new cron's first real run is after promotion to `master`."
- `apps/website/app_docs/environment-setup.md`: add a row for `CRON_SECRET` ("Bearer secret Vercel sends to cron routes; production only; route returns 500 if unset") and, if missing, `RESEND_FROM_EMAIL` / `ADMIN_NOTIFICATION_EMAIL` with their role in this email (bcc and reply-to).
- `apps/website/.env.example`: add `CRON_SECRET=a-random-string-of-at-least-16-chars`. Do not open real `.env*` files.
- `docs/conditional-docs.md`, under `## apps/website`, add:
  ```
  - `apps/website/app_docs/feature-6d199710-pre-arrival-email-cron.md`
    - Conditions:
      - When adding a scheduled job (Vercel Cron) or a guest email
      - When changing the pre-arrival email, its copy, `pre_arrival_email_sent_at`, or `/api/cron/pre-arrival`
      - When a guest did not get, or got twice, their pre-arrival email
  ```
  The document phase writes the app_doc itself.

### 15. Browser/Playwright coverage decision

- No `*.browser.test.tsx` and no `apps/website/e2e/*.spec.ts`: the feature has no browser surface. The route is called by Vercel's scheduler, not a page, and the email is server-rendered HTML. The only UI touch (`WhatsAppLink` reading a constant) renders identical markup. No agent-driven journey either.

### 16. Validation

- Run every command in `Validation Commands`.

## Testing Strategy

### Unit Tests

- `pre-arrival.unit.test.ts`: selection window, status and sent filters, too-late classification, month/year rollover, `firstName`, `maskEmail`, `preArrivalWindow`.
- `pre-arrival-email.unit.test.ts`: subject, every required line in the plain-text body, `Hello,` fallback, forbidden content (tax, total, €, confirmation URL, em dash), rendered HTML content and links.
- `resend.unit.test.ts` (extended): Resend payload shape (bcc, replyTo, text, react, subject), throws on `{ error }` and on missing owner address.
- `api/cron/pre-arrival/__tests__/route.unit.test.ts`: auth (401/500), dry run, claim/skip/fail/release, too-late skip, concurrent send-once, DB error, no email in logs.

### Test Coverage

- `src/lib/bookings/__tests__/pre-arrival.unit.test.ts` (`*.unit.test.ts`): catches a selection that emails pending/cancelled/already-sent bookings, sends on the day of arrival, or misses the catch-up day; nothing tests this today because the module does not exist.
- `src/lib/bookings/__tests__/pre-arrival-email.unit.test.ts` (`*.unit.test.ts`): catches missing arrival facts ("from 3 pm", "by 11 am", address, parking) and any price, tax or total leaking into the guest email.
- `src/lib/__tests__/resend.unit.test.ts` extension (`*.unit.test.ts`): catches a send without the owner bcc/reply-to or a swallowed Resend error that would leave the claim set and the guest never emailed.
- `src/app/api/cron/pre-arrival/__tests__/route.unit.test.ts` (`*.unit.test.ts`): catches an unauthenticated or fail-open cron route, a dry run that sends, a failed send that is never retried, and a double send under duplicate Vercel invocations (proved by the negative check on the `is null` claim predicate).
- No browser or Playwright test: there is no page or user interaction; see task 15.
- The migration itself: no test; it is a single nullable column add, validated by `yarn supabase migration up` locally and the `migrations.yml` dry-run on the PR.

### Edge Cases

- Cron missed a day: a booking now at today+1 is still selected.
- Booking made inside the window (e.g. booked today for tomorrow): selected on the next run if check-in is still ≥ today+1; if check-in is today, logged and skipped as too late.
- Duplicate cron delivery, concurrently or later the same day: the conditional claim makes the second a skip.
- Send fails: claim released, next day retries if still in window; if the next day is check-in day it becomes too late (acceptable, logged, Sentry already has the failure).
- `guest_name` null, empty, or multi-word; name with leading whitespace.
- Contact has no email (legacy phone-only contact linked): skipped with Sentry, not claimed.
- Month and year rollover in the window arithmetic.
- `CRON_SECRET` unset or empty string; header with a different scheme or extra whitespace (exact match only).
- `ADMIN_NOTIFICATION_EMAIL` unset: send throws, claim released, `failed` reported.
- Supabase embed returned as array instead of object: route normalises.
- Runner timezone: tests pin system time to 12:00 UTC so the local calendar day matches; production runs in UTC.

## Acceptance Criteria

- Migration `20260929120000_add_pre_arrival_email_sent_at_to_bookings.sql` adds a nullable `timestamptz` column and nothing else; applies locally with `yarn supabase migration up`.
- `GET /api/cron/pre-arrival` returns 500 when `CRON_SECRET` is unset, 401 unless `Authorization` is exactly `Bearer ${CRON_SECRET}`, and otherwise `{ sent, skipped, failed }`.
- `?dryRun=1` returns candidates (booking id, check-in, masked email) and neither claims nor sends.
- Only confirmed, not-yet-sent bookings with check-in on today+1 or today+2 (UTC) are emailed; check-in today or earlier is logged and skipped.
- The claim uses `... where id = $1 and pre_arrival_email_sent_at is null` and runs before sending; two concurrent invocations send once (unit-proved; negative check performed and reverted).
- A failed send resets `pre_arrival_email_sent_at` to null, calls Sentry `captureException`, and appears in `failed`.
- Logs contain booking ids, never guest emails.
- Email: subject `Your stay at issebya.homes is coming soon`; body lines exactly as in the issue; `text:` alternative with the same content; `bcc` and `replyTo` = `ADMIN_NOTIFICATION_EMAIL`; from `RESEND_FROM_EMAIL`; no price, tax, total, confirmation URL, em dash, emoji or bold.
- `apps/website/vercel.json` has the cron `0 7 * * *` on `/api/cron/pre-arrival` and keeps `ignoreCommand`.
- Root `AGENTS.md` has the crons line; `docs/conditional-docs.md` has the new entry; `environment-setup.md` documents `CRON_SECRET`.
- All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn supabase migration up` - (repo root) applies the new migration to the shared local database without a reset
- `yarn supabase migration list --local` - confirms `20260929120000` is applied locally
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn workspace website vitest run --project unit src/lib/bookings src/app/api/cron src/lib/__tests__/resend.unit.test.ts` - The new tests pass in isolation
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the feature works with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and lists `/api/cron/pre-arrival` as a dynamic route

## Notes

- No new dependencies. `resend`, `date-fns`, `@sentry/nextjs`, `@supabase/supabase-js` and `react-dom/server` are already available.
- The confirmation email's promise ("48 hours before your arrival, we'll send you ...") is left unchanged; changing it is out of scope.
- Hobby cron timing: the job fires once between 07:00 and 07:59 UTC. Delivery is best effort with no retries; the reconciliation window plus the claim column are what make that acceptable.
- The claim-before-send order trades "possibly never sent if the process dies between claim and send" for "never sent twice". The window between claim and send is one Resend call; a crash there leaves `pre_arrival_email_sent_at` set without an email. Acceptable for this volume; the owner bcc makes a missing send visible.
- **Owner steps to state in the PR body:**
  1. Add `CRON_SECRET` (random, at least 16 characters, e.g. `openssl rand -hex 24`) to the `ihas-website` Vercel project, Production environment.
  2. Crons run only on the production deployment, so the first real run happens after the develop → master promotion (which also applies the migration via `migrations.yml`).
  3. Test from the Vercel dashboard's Cron Jobs page with "Run", or call `GET https://issebya.com/api/cron/pre-arrival?dryRun=1` with `Authorization: Bearer <CRON_SECRET>` to see candidates first. After a real run, the owner receives the bcc and the booking row shows `pre_arrival_email_sent_at`.
- The 2026-10-01 booking already got a hand-sent email. If the promotion lands before 2026-10-01 07:00 UTC, the first run will email that guest again. Before promoting, the owner may set `pre_arrival_email_sent_at = now()` on that booking in Supabase Studio to suppress it; call this out in the PR.
- Future: other reminder offsets, SMS/WhatsApp delivery and custom arrival times are out of scope, but the column-per-message plus conditional-claim pattern generalises to them.
