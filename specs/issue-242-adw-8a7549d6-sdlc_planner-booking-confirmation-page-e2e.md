# Bug: booking confirmation page content has no end-to-end coverage

## Metadata

issue_number: `242`
adw_id: `8a7549d6`
issue_json: `{"number":242,"title":"test(website): Playwright e2e for what the booking confirmation page shows"}`

## Bug Description

`/booking/confirmation?session=<id>` is the page a guest reads right after paying: room, check-in and check-out dates, nights, guests, price rows and the email the confirmation went to. None of that content is asserted end to end. The only Playwright coverage of the page (`e2e/blog-booking-flow.integration.spec.ts`, describe "Booking confirmation returns to the originating post") checks the `Booking Confirmed` heading and the `return-to-post` link. `PriceBreakdown.browser.test.tsx` covers the price rows as an isolated component with props, not the page rendering real database data through `/api/bookings/direct`.

Expected: a regression in the date formatting, the `Guest` / `Guests` plural, the tourist-tax row being hidden for a lock-in week, the room label, the email join through `guest_contacts`, the mobile-hidden photo or the no-session not-found path fails a spec. Actual: any of those can break silently.

## Problem Statement

Add a Playwright integration spec that seeds confirmed bookings in the shared local Supabase and asserts every value the confirmation page renders, for a nightly room1 booking with tourist tax, a room2 lock-in week with no tourist tax, a mobile viewport, and a missing session, without ever reaching the real Stripe API.

## Solution Statement

Create `apps/website/e2e/booking-confirmation.integration.spec.ts`, test-only, no change under `src/`. Copy the `seedConfirmedBooking` pattern from `blog-booking-flow.integration.spec.ts` into the new file (not refactored out), parameterised by room, dates, person count and prices, with session ids `cs_test_e2e_confirmation_<uuid>` and cleanup of both rows in `finally`. Only `confirmed` rows are seeded, so `/api/bookings/direct` serves them straight from the database and never calls `stripe.checkout.sessions.retrieve` (which `E2E_MOCK_STRIPE` does not mock). Fixture dates start at today +120 so they clear every other spec's window (room1 +10..+13, room2 +40..+43, lock-in weeks from 2 Nov 2026 for 12 weeks, which end around 25 Jan 2027; +120 from 2026-10-15 is 2027-02-12).

Values that are a plain `<label>` + `<p>` pair (no form control, so `getByLabel` will not resolve them) are read by scoping to the label text's parent: `page.locator("label", { hasText: /^Room$/ }).locator("..")` and asserting the sibling `p` text. Price rows are `<div>` with two `<span>`s; scope the same way from `getByText("Room price", { exact: true }).locator("..")`. No test id is added.

## Steps to Reproduce

1. Read `apps/website/e2e/*.spec.ts`: no spec asserts Room, Check-in, Check-out, Nights, Guests, any price row or the confirmation email on `/booking/confirmation`.
2. Temporarily change `touristTax !== 0` to `true` in `src/app/(main)/booking/confirmation/ui/PriceBreakdown.tsx` and run `PORT=$PORT yarn workspace website test:integration --project=chromium`: the suite stays green (the existing confirmation tests only look at the heading and the return link). Revert.
3. Same with the `Guest` / `Guests` branches swapped in `page.tsx`: still green. Revert.

## Root Cause Analysis

Not a production defect: a coverage gap. The confirmation page's e2e tests were written for the blog-return feature (issue 94) and only assert what that feature added. The page's own content, which depends on real data shapes (date-only columns rendered through `fromCalendarDay`, the `guest_contacts(email)` join flattened by the route, `tourist_tax` of 0 for lock-in weeks, the `hidden md:flex` photo column) was never pinned by a test that renders it from the database, so a regression in any of them would ship unnoticed.

## Relevant Files

Use these files to fix the bug:

- `AGENTS.md` - repo rules: yarn only, shared local Supabase never reset, ports.
- `apps/website/AGENTS.md` - calendar days are `"yyyy-MM-dd"` strings, convert only with `toCalendarDay` / `fromCalendarDay`, never `new Date("yyyy-MM-dd")`; the e2e suite is not in CI.
- `apps/website/app_docs/testing/e2e_example.md` - Playwright spec conventions (conditional-docs: "When adding a Playwright spec under `apps/website/e2e/`").
- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md` - why an `e2e/` spec never runs in CI (conditional-docs entry).
- `apps/website/app_docs/database/database-interaction-rules.md` - reading/writing the database (fixtures seeded via `createAdminClient()`).
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` - `seedConfirmedBooking` (lines ~209-260) is the fixture pattern to copy; its comments explain why confirmed rows avoid Stripe.
- `apps/website/playwright.config.ts` - `workers: 1`, `PORT`-driven `baseURL`, `reuseExistingServer: !process.env.CI`, default viewport 1280 wide, loads `.env.development` for `createAdminClient()`.
- `apps/website/src/app/(main)/booking/confirmation/page.tsx` - what is rendered: heading, subtitle, label/value pairs, `formatDate` (en-GB `day numeric, month long, year numeric`), `Guest`/`Guests`, email sentence, image with `alt` = room label in a `hidden md:flex` column; `notFound()` when `session` is falsy (covers both missing and empty `?session=`).
- `apps/website/src/app/(main)/booking/confirmation/ui/PriceBreakdown.tsx` - `Room price`, `Tourist tax` only when `touristTax !== 0`, `Total`, each as `€<n>`.
- `apps/website/src/app/(main)/booking/confirmation/loading.tsx` - "Loading your booking..." fallback; assertions must wait for content with web-first `expect`, not read the DOM once.
- `apps/website/src/app/api/bookings/direct/route.ts` - confirmed rows served from the DB with `email` flattened from `guest_contacts(email)`; pending or missing rows call `stripe.checkout.sessions.retrieve`.
- `apps/website/src/lib/date-utils.ts` - `toCalendarDay` / `fromCalendarDay`.
- `apps/website/src/lib/shared/supabase` - `createAdminClient()`.
- `apps/website/src/app/(main)/not-found/page.tsx` - note: this is a `/not-found` route, not a not-found boundary. Neither `(main)` nor `src/app` has a `not-found.tsx`, so `notFound()` renders Next's default page ("404" / "This page could not be found.").

### New Files

- `apps/website/e2e/booking-confirmation.integration.spec.ts` - the new spec.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions and the no-session response

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/testing/e2e_example.md` and `seedConfirmedBooking` in `e2e/blog-booking-flow.integration.spec.ts`.
- Source `.ports.env` (`PORT=9213` at planning time; never edit it). With the `prepare_app` server up on `$PORT`, run `curl -s -o /tmp/nf.html -w "%{http_code}\n" "http://localhost:$PORT/booking/confirmation"` and the same for `?session=` two or three times each, and grep the body for `This page could not be found` and `404`. Decide from that:
  - if the code is a stable `404` on every run, assert `response.status()` is 404 in test 4;
  - otherwise (200 because the response streamed past `loading.tsx`, or it varies) do not assert the status; assert the text only, and say so in a short comment in the spec.
- Never start a second server or touch whatever is on port 3000.

### 2. Create the spec file and fixture helper

- Create `apps/website/e2e/booking-confirmation.integration.spec.ts`. Imports: `randomUUID` from `node:crypto`, `expect`, `test` (and `type Page` if needed) from `@playwright/test`, `addDays`, `startOfDay` from `date-fns`, `createAdminClient` from `@/lib/shared/supabase`, `fromCalendarDay`, `toCalendarDay` from `@/lib/date-utils`.
- `const today = startOfDay(new Date());` and day strings via `toCalendarDay(addDays(today, n))` (never `format` inline, never `new Date("yyyy-MM-dd")`).
- A local `formatDay(day: string)` that returns `fromCalendarDay(day).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })`, mirroring the page.
- `seedConfirmedBooking({ roomType, checkIn, checkOut, nights, personCount, basePrice, touristTax, totalAmount })`: insert a `guest_contacts` row (random `phone` `+000<10 digits from a uuid>`, random `email` `e2e-confirmation-<uuid>@example.com`, `guest_name: "E2E Confirmation Fixture"`, `enabled: false`), then a `bookings` row with those values, `guest_contact_id`, `source: "direct"`, `status: "confirmed"`, `stripe_session_id: cs_test_e2e_confirmation_<uuid>`. On booking insert failure delete the contact and throw. Return `{ sessionId, email, cleanup }` where `cleanup` deletes the booking then the contact. Keep the comment explaining why a confirmed row keeps the spec off Stripe and why the dates start at +120.
- A small helper `fieldValue(page, label)` returning `page.locator("label", { hasText: new RegExp(\`^${label}$\`) }).locator("..").locator("p")`, and `priceRow(page, label)`returning`page.getByText(label, { exact: true }).locator("..")`.
- Fixture constants: nightly `room1`, check-in +120, check-out +123, 3 nights, 2 guests, 300 / 12 / 312; lock-in `room2`, check-in +130, check-out +137, 7 nights, 1 guest, 700 / 0 / 700.

### 3. Test 1: nightly booking, room1, with tourist tax

- Seed, `try { ... } finally { await cleanup(); }`.
- `page.goto(\`/booking/confirmation?session=${encodeURIComponent(sessionId)}\`)`.
- Assert `getByRole("heading", { level: 1, name: "Booking Confirmed" })` visible and `getByText("Thank you for your reservation")` visible.
- `fieldValue("Room")` has text `Room 1`; `Check-in` / `Check-out` equal `formatDay(checkIn)` / `formatDay(checkOut)`; `Nights` `3`; `Guests` `2 Guests`.
- `priceRow("Room price")` contains `€300`, `priceRow("Tourist tax")` contains `€12`, `priceRow("Total")` contains `€312`.
- `getByText(/A confirmation email has been sent to/)` contains the fixture's `email`.
- `getByRole("img", { name: "Room 1" })` visible; `getByTestId("return-to-post")` has count 0.

### 4. Test 2: lock-in week, room2, no tourist tax

- Seed the lock-in fixture, same try/finally.
- Assert heading, Room `Room 2`, Nights `7`, Guests `1 Guest` (use exact text so `1 Guests` fails), Check-in/Check-out via `formatDay`, `priceRow("Room price")` `€700`, `priceRow("Total")` `€700`, and `page.getByText("Tourist tax")` has count 0 (after the heading is visible, so the page has rendered).

### 5. Test 3: mobile hides the photo

- `test.use({ viewport: { width: 375, height: 667 } })` inside its own `test.describe`, or `page.setViewportSize` before `goto`.
- Seed test 1's fixture; assert heading, Room `Room 1`, Nights `3`, Guests `2 Guests` and `Total` `€312` visible, and `getByRole("img", { name: "Room 1" })` not visible (`toBeHidden()`; the column is `display: none` below `md`).

### 6. Test 4: no session

- For `/booking/confirmation` and `/booking/confirmation?session=` (a loop of two tests): `const response = await page.goto(url)`; assert `getByText("This page could not be found.")` visible and `getByRole("heading", { name: "Booking Confirmed" })` count 0. Assert `response?.status()` only per the decision in step 1. No fixture, no Stripe.

### 7. Run the new spec, then the full suite

- `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/booking-confirmation.integration.spec.ts` passes.
- Then the full suite with the same command and no file filter passes.

### 8. Negative checks (do not commit)

- Change `touristTax !== 0` to `true` in `ui/PriceBreakdown.tsx`; run the new spec: test 2 must fail on the `Tourist tax` count. Revert with `git checkout -- <file>`.
- Swap the `"Guest"` / `"Guests"` branches in `page.tsx`; run the new spec: tests 1 and 2 must fail on Guests. Revert.
- `git status` shows only the new spec (and this plan) changed; nothing under `src/`.

### 9. Leftover fixture check and validation

- `docker exec supabase_db_issebya-homes-ai-system psql -U postgres -Atc "select count(*) from public.bookings where stripe_session_id like 'cs_test_e2e_confirmation_%'"` prints `0`.
- Run every command in `Validation Commands`.

## Test Coverage

New Playwright integration spec (`apps/website/e2e/*.spec.ts` layer), `apps/website/e2e/booking-confirmation.integration.spec.ts`: it catches regressions in what the confirmation page renders from a real confirmed booking (room label, en-GB dates, nights, guest plural, price rows incl. hiding a zero tourist tax, the email joined from `guest_contacts`, the desktop-only photo, and the not-found path without a session). Proven to fail against a broken page by the two negative checks in step 8. Note it is not a CI gate (the e2e suite runs only in the ADW test phase and by hand, see `apps/website/AGENTS.md`); the component-level gate for the price rows stays `PriceBreakdown.browser.test.tsx`.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `source .ports.env` - this run's `PORT`; never edit the file.
- `yarn turbo run typecheck --filter=./apps/website` - the spec type-checks against the Supabase types and `@/lib` imports.
- `yarn turbo run lint --filter=./apps/website` - lint rules for the new file.
- `yarn prettier --check .` - formatting.
- `yarn knip` - no unused exports or files introduced.
- `yarn turbo run test --filter=./apps/website` - unit and chromium browser projects still pass (nothing under `src/` changed).
- `yarn turbo run build --filter=./apps/website` - build still passes.
- `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/booking-confirmation.integration.spec.ts` - the new spec passes.
- `PORT=$PORT yarn workspace website test:integration --project=chromium` - full e2e suite passes, no fixture collisions.
- `docker exec supabase_db_issebya-homes-ai-system psql -U postgres -Atc "select count(*) from public.bookings where stripe_session_id like 'cs_test_e2e_confirmation_%'"` - prints `0`, no leftover fixtures.
- `git diff --stat develop -- apps/website/src` - empty: no production change.

## Notes

- No new dependency.
- Never set `CI=1` (it disables `reuseExistingServer` and drops to a fresh server); reuse the `prepare_app` server on `$PORT`.
- Never seed a `pending` row or open a session id with no row: both call `stripe.checkout.sessions.retrieve`, which is not mocked. Do not add a retrieve mock here.
- Never run `supabase start` / `stop` / `db reset`, a migration or a seed; fixtures go only through `createAdminClient()`.
- `Room price` and `Total` both render `€700` in test 2; scope each assertion to its row rather than `getByText("€700")`, which would match twice (strict-mode violation).
- The label `Room`, the value `Room 1` and the row `Room price` all contain "Room"; read values through `fieldValue` / `priceRow` or `exact: true` to stay unambiguous.
- No em dashes in the spec. Commit as `test(website): ...` with no attribution trailer.
