# Chore: test(website): e2e from booking to confirmed booking, with tourist tax, for both rooms

## Metadata

issue_number: `248`
adw_id: `fcc99992`
issue_json: `{"number":248,"title":"test(website): e2e from booking to confirmed booking, with tourist tax, for both rooms"}`

## Chore Description

Add one Playwright integration spec, `apps/website/e2e/booking-webhook-confirmation.integration.spec.ts`,
that drives a paid booking end to end. The guest books in the real UI. The in-process Stripe mock
(`E2E_MOCK_STRIPE`) creates the Checkout Session and the app writes a `pending` row. The spec then
posts a correctly signed `checkout.session.completed` event to the app's real webhook route
(`POST /api/webhook/stripe`). The booking ends `confirmed` with the right tourist tax, both in the
database and on `/booking/confirmation?session=<id>`.

Five tests:

1. nightly room1 (+200..+203, 2 guests);
2. nightly room2 (+210..+213, 2 guests);
3. lock-in week room1 (latest free week);
4. lock-in week room2 (latest free week);
5. bad signatures are rejected and a seeded pending room2 booking (+220..+223) stays pending, with
   a valid control post at the end.

Today no spec reaches the webhook. `booking-flow` and `lock-in-flow` stop at the Stripe redirect,
and `booking-confirmation` seeds rows that are already `confirmed`.

This change is test-only. Nothing changes under `src/`, `packages/` or in `playwright.config.ts`.
The document phase writes the feature doc.

Facts checked in the code while planning (worktree at 1250d8e):

- `src/app/api/webhook/stripe/route.ts`: no header gives `400 {"error":"Missing stripe-signature header"}`. A failing `constructEvent` gives `400 {"error":"Invalid signature"}`. For `checkout.session.completed` the route reads `event.data.object` (`id`, `payment_intent`, `metadata`) and never calls Stripe. If `roomType/checkIn/checkOut/personCount/email/phone/guestName` is incomplete it answers `200 {received:true}` and changes nothing. Otherwise it calls `upsertGuestContact`, then updates the pending row to `confirmed` + `payment_intent`.
- `src/app/(main)/booking/[type]/actions.ts`: the metadata values are all strings: `whatsappOptIn: String(whatsappOptIn)`, `touristTax: String(touristTax)`, and so on. The pending insert writes `tourist_tax: touristTax`, `stripe_session_id: session.id`, `source`.
- `whatsappOptIn` default: `BookingEngineExpanded.tsx:131` sets `whatsappOptIn: false`. The checkbox (`BookingGuestForm.tsx`, `name="whatsappOptIn"`) is unchecked unless the guest ticks it, and `fillGuestDetails` never ticks it. So the metadata value is `"false"`. Still read the checkbox's checked state before submitting, so the spec does not rely on this default.
- `src/lib/price-utils.ts` exports `calculateTotalPrice(checkIn: Date, checkOut: Date, persons)`, `calculateLockInPrice()` and `formatPrice(price) => \`${price}€\``. `LOCK_IN_PRICING`comes from`pricing`(as`lock-in-flow` imports it).
- The nightly summary renders `Tourist tax: {formatPrice(touristTax)}*` (`BookingSummaryRow.tsx:82`). The engine also has a footnote link whose text is just "Tourist tax". So match the summary with the full `Tourist tax: ${formatPrice(n)}` substring, never a bare "Tourist tax".
- The confirmation page's `PriceBreakdown.tsx` renders `€{basePrice}`, `€{touristTax}` (left out when `touristTax === 0`) and `€{total}`, each as `<div><span>label</span><span>amount</span></div>`. That is why `priceRow` from `booking-confirmation.integration.spec.ts` works.
- `apps/website/.env.development` defines `STRIPE_WEBHOOK_SECRET`. `playwright.config.ts` `loadDevEnv()` loads it into the test process. `workers: 1`, `timeout: 30000`.
- `getAvailability` is `cacheTag("availability", "availability-<room>")` with `cacheLife("minutes")`. `/api/e2e-ical-mock` expires only `availability-room1`. The webhook itself calls `revalidateTag("availability-<roomType>")` on confirm.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md`: repo rules: yarn only, conventional commits, no em dashes, shared Supabase, ports.
- `.adw/project.md`: the profile: Tests and E2E command, `PORT` from `.ports.env`, Protected (no `supabase` reset, no seeds, never `CI=1`).
- `apps/website/AGENTS.md`: calendar days are `"yyyy-MM-dd"` strings converted only with `toCalendarDay`/`fromCalendarDay`, never `new Date("yyyy-MM-dd")`. The e2e suite is not in CI.
- `docs/conditional-docs.md`: the index. The document phase adds the feature doc entry under `## apps/website`.
- `apps/website/app_docs/database/database-interaction-rules.md`: rules for the `createAdminClient()` seed and cleanup.
- `apps/website/app_docs/testing/e2e_example.md`, `apps/website/app_docs/testing/e2e_runner.md`: e2e format and runner conventions.
- `apps/website/playwright.config.ts`: read only. `loadDevEnv`, `webServer` reuse, `workers: 1`, `baseURL` from `PORT`.
- `apps/website/e2e/support/journeys.ts`: reuse `mockStripeCheckout`, `uniqueGuest`, `fillGuestDetails`, `confirmAndReachStripe`, `deleteGuestBookings`, `pickFreeLockInWeek`, `lockInWeekLabel`. Do not modify.
- `apps/website/e2e/booking-confirmation.integration.spec.ts`: copy the `priceRow`, `fieldValue` and `confirmationUrl` helpers from it. Also the model for the `guest_contacts` + `bookings` seed (random `+000…` phone, `enabled: false`). Do not refactor it.
- `apps/website/e2e/lock-in-flow.integration.spec.ts`: model for the lock-in journey and the `expireRoom1Availability` helper. It picks the earliest free week, so ours picks the latest.
- `apps/website/e2e/booking-flow.integration.spec.ts`: model for the nightly journey ("Book selected dates" then "Confirm booking").
- `apps/website/src/app/api/webhook/stripe/route.ts`: read only. The contract the spec posts to.
- `apps/website/src/app/(main)/booking/[type]/actions.ts`: read only. `createCheckout` metadata keys and the pending insert. The negative checks 1 and 2 are temporary edits here.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`: read only. `resolveInitialCheckDates`: URL dates preselect the range for a direct visitor, and a blocked range is rejected.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingSummaryRow.tsx`, `BookingGuestForm.tsx`: read only. The summary text and the `whatsappOptIn` checkbox.
- `apps/website/src/app/(main)/booking/confirmation/ui/PriceBreakdown.tsx`: read only. The confirmation price rows.
- `apps/website/src/lib/price-utils.ts`, `packages/pricing/src/index.ts`: read only. Expected values come from here.
- `apps/website/src/lib/lock-in.ts`: `getLockInWeeks(new Date())`.
- `apps/website/src/lib/date-utils.ts`: `toCalendarDay`, `fromCalendarDay`.
- `apps/website/src/lib/shared/supabase.ts`: `createAdminClient()`.
- `apps/website/src/instrumentation.ts`: read only. The Stripe mock answers only `POST /v1/checkout/sessions` with `cs_test_e2e_<uuid>`.

### New Files

- `apps/website/e2e/booking-webhook-confirmation.integration.spec.ts`: the new spec, the only file this plan adds. The document phase adds the feature doc and its index entry.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions and the code the spec depends on

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/testing/e2e_example.md` and `apps/website/app_docs/database/database-interaction-rules.md`.
- Read the files marked "read only" above, so the selectors and the metadata keys match the code, not this plan.
- Source `.ports.env` for `PORT`. Confirm the `prepare_app` server is up on it with `E2E_MOCK_STRIPE`, `E2E_MOCK_ICAL_FAILURE` and `E2E_MOCK_RESEND` all `true`. Never start a second server and never touch port 3000 unless `PORT` is 3000.

### 2. Scaffold the spec file: imports, constants, secret guard

- Imports:
  - `randomUUID` from `node:crypto`;
  - `expect`, `test`, `type APIRequestContext`, `type Page` from `@playwright/test`;
  - `addDays`, `startOfDay` from `date-fns`;
  - `Stripe` (default import) from `stripe`;
  - `LOCK_IN_PRICING` from `pricing`;
  - `fromCalendarDay`, `toCalendarDay` from `@/lib/date-utils`;
  - `getLockInWeeks` from `@/lib/lock-in`;
  - `calculateLockInPrice`, `calculateTotalPrice`, `formatPrice` from `@/lib/price-utils`;
  - `createAdminClient` from `@/lib/shared/supabase`;
  - the journeys helpers from `./support/journeys`.
- `const today = startOfDay(new Date())`. `const day = (n: number) => toCalendarDay(addDays(today, n))`.
- A header comment listing the date windows this spec owns: room1 +200..+203, room2 +210..+213, room2 +220..+223 (test 5), and the latest free lock-in week. Say why they are clear of the other specs (+10..+13, +40..+43, +120..+147, the earliest lock-in week, +300..+302).
- `webhookSecret()` reads `process.env.STRIPE_WEBHOOK_SECRET`. If it is unset, it throws `new Error("STRIPE_WEBHOOK_SECRET is not set: the server and the Playwright process must both have it (apps/website/.env.development or an exported value)")`. Call it at the top of each test, not at module load, so the other specs in a full run still load. Never log the value.
- Copy `priceRow`, `fieldValue` and `confirmationUrl` from `booking-confirmation.integration.spec.ts`, with a one-line comment saying they were copied on purpose.
- Copy `expireRoom1Availability(request)` from `lock-in-flow.integration.spec.ts`: `POST /api/e2e-ical-mock {enabled:false}`, expect ok.

### 3. Add the `postSignedCompletedEvent` helper

- Signature: `postSignedCompletedEvent(request: APIRequestContext, { sessionId, metadata, paymentIntent, secret = webhookSecret(), signature }: {...})`. `signature` is optional: `"none"` (send no header), or an override body to post in place of the signed one (the tampered case). Keep it small. An alternative is to export `buildCompletedEvent()` (returns `body`) plus `signBody(body, secret)` and `postWebhook(request, body, header?)`, and have `postSignedCompletedEvent` compose them. That keeps test 5 readable. Pick one and keep it local to the spec.
- Payload: `{ id: \`evt_test_e2e_${randomUUID()}\`, object: "event", type: "checkout.session.completed", api_version: "2025-08-27.basil", created: Math.floor(Date.now() / 1000), livemode: false, data: { object: { id: sessionId, object: "checkout.session", status: "complete", payment_status: "paid", payment_intent: paymentIntent, metadata } } }`.
- `const body = JSON.stringify(payload)`. `const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret })`. Never a hand-rolled HMAC.
- `request.post("/api/webhook/stripe", { data: body, headers: { "stripe-signature": header, "content-type": "application/json" } })`. Post the exact signed string (a `string` passed as `data` goes out verbatim). Return the response.

### 4. Add the DB helpers

- `contactFor(email)`: `guest_contacts` `select("id, phone").eq("email", email).single()`. Assert no error. Returns `{ id, phone }`.
- `bookingsFor(contactId)`: `bookings` `select("id, room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, status, stripe_session_id, payment_intent, source").eq("guest_contact_id", contactId)`.
- `metadataFrom(row, guest, phone, whatsappOptIn)`: rebuilds what `createCheckout` sent, every value a string:
  - from the pending row: `roomType`, `checkIn`, `checkOut`, `personCount`, `nights`, `basePrice`, `touristTax`, `total` (use `String(Number(row.x))` for the numeric columns, so `"12"` and not `"12.00"`, matching `String(touristTax)` in `createCheckout`);
  - `email` from the guest; `guestName: "Guest Example"` (what `fillGuestDetails` types);
  - `phone` read from the `guest_contacts` row, never recomputed;
  - `whatsappOptIn: String(checked)`;
  - `source: "direct"`.

### 5. Add the shared happy-path runner

A `bookAndConfirm` flow, used by tests 1 to 4:

- `const guest = uniqueGuest("e2e-webhook-")`. Wrap everything after the first DB write in `try { … } finally { await deleteGuestBookings(guest.email); if (room === "room1") await expireRoom1Availability(request); }`.
- After `fillGuestDetails`, and before `confirmAndReachStripe`, read the opt-in state: `const optIn = await page.locator('input[name="whatsappOptIn"]').isChecked()`.
- After `confirmAndReachStripe`, run the pending-row assertions:
  - `contactFor(guest.email)`; `bookingsFor(contact.id)` has length 1;
  - `status: "pending"`, `stripe_session_id` matches `/^cs_test_e2e_/`, `payment_intent` null;
  - `check_in`/`check_out` equal the expected calendar days;
  - `Number(tourist_tax)` equals `expected.touristTax`;
  - `nights` equals `expected.nights`.
- Post the signed event with `paymentIntent = \`pi_test_e2e_${randomUUID()}\``. Expect status 200 and `await res.json()`to equal`{ received: true }`.
- Confirmed-row assertions:
  - re-read the rows: still length 1, same `id`;
  - `status: "confirmed"`, `payment_intent` equals the posted value;
  - `Number(tourist_tax)`, `Number(total_amount)`, `nights` and `person_count` as each test expects.
- Only now open `confirmationUrl(sessionId)`, then assert the heading `getByRole("heading", { level: 1, name: "Booking Confirmed" })` is visible, followed by the per-test page assertions.

### 6. Tests 1 and 2: nightly, room1 (+200..+203) and room2 (+210..+213)

- Loop `for (const [room, offset] of [["room1", 200], ["room2", 210]] as const)` inside `test.describe("Booking to confirmed booking through the Stripe webhook", …)`.
- `checkIn = day(offset)`, `checkOut = day(offset + 3)`. `expected = calculateTotalPrice(fromCalendarDay(checkIn), fromCalendarDay(checkOut), 2)`.
- `mockStripeCheckout(page)`. Go to `/booking/${room}?checkIn=${checkIn}&checkOut=${checkOut}`. Click `getByLabel("Book selected dates")`. Expect `getByLabel("Confirm booking")` to be visible. Click `getByLabel("Increase number of persons")` once.
- Expect `page.getByText(\`Tourist tax: ${formatPrice(expected.touristTax)}\`)` to be visible. This also proves the URL range was accepted (see Notes on the room2 cache).
- `fillGuestDetails`, read the opt-in, `confirmAndReachStripe`, then the step 5 flow.
- Confirmed row:
  - `Number(tourist_tax) > 0` and equal to `expected.touristTax`;
  - `Number(total_amount) === expected.total`;
  - `nights === expected.nights` (and `expect(expected.nights).toBe(3)`, which guards the fixture itself);
  - `person_count === 2`.
- Page: `priceRow(page, "Tourist tax")` contains `€${expected.touristTax}`, and `priceRow(page, "Total")` contains `€${expected.total}`.

### 7. Tests 3 and 4: lock-in week, room1 and room2

- Loop over `["room1", "room2"] as const`.
- `mockStripeCheckout(page)`. Go to `/lock-in/${room}`. Expect `.lock-in-week` to have count 12.
- `const picked = await pickFreeLockInWeek(page, [...getLockInWeeks(new Date())].reverse())`. `expected = calculateLockInPrice()`.
- `fillGuestDetails`, read the opt-in, `confirmAndReachStripe`, then the step 5 flow with `check_in`/`check_out` equal to `picked`.
- Pending row: `nights` 7 (`expected.nights`) and `Number(tourist_tax) === 0`.
- Confirmed row:
  - `Number(tourist_tax) === 0` (the one allowed literal: a lock-in has no tourist tax);
  - `Number(total_amount) === LOCK_IN_PRICING.weekPrice`;
  - `payment_intent` equals the posted value.
- Page, checked after the heading is visible:
  - `fieldValue(page, "Nights")` has text `"7"`;
  - `priceRow(page, "Total")` contains `€${LOCK_IN_PRICING.weekPrice}`;
  - `page.getByText("Tourist tax")` has count 0.

### 8. Test 5: bad signatures are rejected and the booking stays pending (room2, +220..+223)

- Seed with `createAdminClient()`, modelled on `seedConfirmedBooking`:
  - a `guest_contacts` row: `phone: \`+000${randomUUID().replace(/\D/g, "").slice(0, 10)}\``, `email: \`e2e-webhook-${randomUUID()}@example.com\``, `guest_name: "Guest Example"`, `enabled: false`;
  - a `bookings` row: room2, `day(220)`..`day(223)`, values from `calculateTotalPrice(fromCalendarDay(ci), fromCalendarDay(co), 1)` (nights, `person_count: 1`, base_price, tourist_tax, total_amount), `source: "direct"`, `stripe_session_id: \`cs_test_e2e_webhook_${randomUUID()}\``, `status: "pending"`.
  - If the booking insert fails, delete the contact and throw.
- Metadata: built with `metadataFrom` from the seeded row and the seeded contact's phone, email and name, with `whatsappOptIn: "false"`.
- Build one valid `body` and its correct `header`. In `try`:
  1. post the body with no `stripe-signature` header: 400, `{ error: "Missing stripe-signature header" }`;
  2. post the body with a header signed with `whsec_e2e_wrong_secret`: 400, `{ error: "Invalid signature" }`;
  3. post the correct header with a different body (same payload, a different `payment_intent`): 400, `{ error: "Invalid signature" }`.
  - After each one, re-read the row: `status: "pending"`, `payment_intent` null.
  - Control: post the original body with its correct header: 200, `{ received: true }`. The row becomes `confirmed` with the original `payment_intent`.
- `finally`: delete the booking by id, then the contact by id. In case the webhook's `upsertGuestContact` ran (it matches by email, so it reuses the seeded contact), also run `deleteGuestBookings(email)` as a fallback. Never open the confirmation page in this test.

### 9. Format and static checks

- `yarn prettier --write apps/website/e2e/booking-webhook-confirmation.integration.spec.ts`.
- Typecheck, lint, prettier and knip (see Validation Commands). Grep the file for em dashes (`grep -n "—" …` must print nothing). Note that `lockInWeekLabel` in journeys uses an en dash, which is fine. Do not touch it.

### 10. Run the spec, then the full suite

- `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/booking-webhook-confirmation.integration.spec.ts`: all 5 pass.
- Run it a second time to prove it can be re-run and leaves nothing behind. If room2 test 2 fails on the "Tourist tax" summary within about a minute of the first run, it is the room2 `cacheLife("minutes")` staleness (see Notes): wait out the window and run again. Don't change the source.
- Full suite: `PORT=$PORT yarn workspace website test:integration --project=chromium`, which must pass.
- Leftover checks (each prints `0`): the two `docker exec … psql` counts in Validation Commands.

### 11. Negative checks (temporary source edits, reverted after each)

For each check: make the edit, re-run the new spec, record the exact failing assertion line from the Playwright output, then revert with `git checkout -- <file>`. Confirm `git diff --stat develop` shows only the spec (and docs once the document phase runs).

1. `actions.ts` pending insert: `tourist_tax: touristTax` becomes `tourist_tax: 0`. Tests 1 and 2 must fail on the pending row's tourist tax.
2. `actions.ts` `createCheckout`: replace the `product === "lock-in" ? calculateLockInPrice() : calculateTotalPrice(...)` choice with `calculateTotalPrice(...)` alone. Tests 3 and 4 must fail on `tourist_tax === 0` (and on the "Tourist tax" count).
3. `route.ts` webhook update: `status: "confirmed"` becomes `status: "pending"`. Tests 1 to 4 must fail on `status: "confirmed"`.
4. `route.ts`: replace `stripe.webhooks.constructEvent(...)` with `JSON.parse(rawBody) as Stripe.Event`. Test 5 must fail on the wrong-secret and tampered-body cases. The route imports `Stripe` as a type only, so this edit stays type-valid. It only has to run under the dev server and is never committed.

- The dev server hot-reloads `src/` edits. After each revert, wait for the recompile before the next check. Record the four failure lines for the PR body.

### 12. Commit

- `test(website): e2e from booking to confirmed booking through the Stripe webhook` (Conventional Commits, scope `website`, no attribution lines). lefthook must pass. Never use `--no-verify`.

### 13. Run the Validation Commands

## Test Coverage

- `apps/website/e2e/booking-webhook-confirmation.integration.spec.ts` (Playwright integration layer, the profile's E2E suite) is the chore itself. It catches what nothing catches today:
  - a pending row written without tourist tax (tests 1 and 2);
  - a lock-in charged tourist tax (tests 3 and 4);
  - the webhook failing to move `pending` to `confirmed` or to record `payment_intent` (tests 1 to 4);
  - the confirmation page showing the wrong tax or total after a real confirmation;
  - the webhook accepting an unsigned, wrongly signed or tampered event (test 5).
  - The four negative checks in step 11 prove each one fails without the code it guards.
- No unit or browser test is added. The price maths, email content and the `/api/bookings/direct` recovery path are already unit-tested, and the value here is the end-to-end wiring, which only the e2e layer reaches. This spec does not gate in CI until #249 lands (see `apps/website/AGENTS.md`).

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn turbo run typecheck --filter=./apps/website`: the spec typechecks (Stripe static, Supabase row types).
- `yarn turbo run lint --filter=./apps/website`: lint rules on the new file.
- `yarn prettier --check .`: formatting.
- `yarn knip`: no new unused export or dependency (`stripe` and `pricing` are existing website dependencies).
- `yarn turbo run test --filter=./apps/website`: unit and browser Vitest projects stay green (nothing changed there, so this checks for no regressions).
- `yarn turbo run build --filter=./apps/website`: build stays green.
- `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/booking-webhook-confirmation.integration.spec.ts`: all 5 new tests pass (`PORT` sourced from `.ports.env`; never `CI=1`).
- `PORT=$PORT yarn workspace website test:integration --project=chromium`: the full e2e suite passes with the new spec in it.
- `docker exec supabase_db_issebya-homes-ai-system psql -U postgres -Atc "select count(*) from public.guest_contacts where email like 'e2e-webhook-%'"`: prints `0`, no contacts left behind.
- `docker exec supabase_db_issebya-homes-ai-system psql -U postgres -Atc "select count(*) from public.bookings where stripe_session_id like 'cs_test_e2e_webhook_%'"`: prints `0`, no test 5 bookings left behind.
- `git diff --stat develop`: only the new spec (plus docs from the document phase). No `src/`, `packages/` or `playwright.config.ts` change survives the negative checks.

## Notes

- **room2 availability cache.** Nothing in a spec can expire `availability-room2`. The webhook calls `revalidateTag("availability-room2")` on confirm, but the cleanup delete afterwards does not, so for up to the `cacheLife("minutes")` window the room2 page can still show +210..+213 (or the picked lock-in week) as booked. An immediate re-run of test 2 would then see the URL range rejected, and fails on the "Tourist tax" summary assertion, which acts as the guard. Test 4 just picks the next-latest free week. This is a re-run-timing artifact, not a bug. Note it in a comment by the room2 window, and in the PR if it shows up. Don't add a source hook to expire room2 (out of scope, test-only).
- **Sentry.** Test 5's two bad-signature posts each send a `captureException` to the real Sentry project (DSN hardcoded in `sentry.server.config.ts`). This is accepted in the issue and not changed here.
- **Emails.** Each confirmation sends two emails through Resend, intercepted by `E2E_MOCK_RESEND=true`. Guest addresses are `@example.com` only.
- **Never** load `/booking/confirmation` for a pending row or an unknown session id: that path calls the real `stripe.checkout.sessions.retrieve`, because the MSW mock bypasses unknown requests. Do not add a retrieve handler.
- **`upsertGuestContact` in test 5** resolves the seeded contact by email, so the control post updates that contact and does not create a second one. The `deleteGuestBookings(email)` fallback in `finally` covers both.
- **Numeric columns.** `tourist_tax`, `total_amount` and `base_price` may come back from Supabase as strings or numbers. Compare with `Number(...)` and build the metadata with `String(Number(...))`.
- Do not touch anything from the lock-in waitlist (PR #247): `src/app/lockin-waitlist/`, `src/lib/lockin-waitlist/`, `e2e/lockin-waitlist.integration.spec.ts`.
- No em dashes in any file. Never print or commit `STRIPE_WEBHOOK_SECRET`.
- The document phase writes `apps/website/app_docs/feature-fcc99992-<slug>.md` plus its `docs/conditional-docs.md` entry. That doc must say what the spec covers and that `STRIPE_WEBHOOK_SECRET` must be in the environment of both the server and the test process.
