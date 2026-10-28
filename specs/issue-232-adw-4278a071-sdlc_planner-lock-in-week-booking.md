# Feature: Lock-in page, one-week Monday-to-Monday stays per room from 2 Nov 2026

## Metadata

issue_number: `232`
adw_id: `4278a071`
issue_json: `lock-in`

## Feature Description

From November 2026 the property sells **lock-ins**: a fixed one-week stay in one room, check-in
Monday, check-out the following Monday (7 nights), at a flat week price with no tourist tax. A new
route `/lock-in/[type]` (`room1`, `room2`) sits next to `/booking/[type]` with the same look
(room tabs, gallery, description, capacity note, location, Airbnb reviews link, WhatsApp line). The
only difference is the date picker: instead of the free check-in/check-out calendar, the guest sees
a grid of 12 week cards starting at the first offerable Monday (never before Mon 2026-11-02, never a
week that has already started). A card is "Booked" and not selectable unless all 7 nights are free
on the merged calendar (iCal feeds plus own confirmed bookings). Picking an available card opens the
same guest form the nightly flow uses and goes to Stripe Checkout with a single "lock-in week" line
item. The header gains a "Lock-in" link. The nightly flow stays exactly as it is.

## User Story

As a guest who wants a quiet week away
I want to pick a whole Monday-to-Monday week in one room at a fixed week price
So that I can book a lock-in in one step without working out dates, nights and tourist tax

## Problem Statement

The only way to book today is the nightly flow: a free date range, priced per night plus tourist
tax, computed on the server from whatever dates the browser sends. A lock-in has a fixed shape
(Monday to Monday, 7 nights, from 2 Nov 2026) and a fixed price with no tourist tax. Pushing it
through `submitBooking` would price it as 7 nights plus tax and would accept any range the browser
sends. There is no page that offers weeks, no price for a week, and no server path that refuses a
range that is not a valid lock-in week.

## Solution Statement

- **Price**: add `LOCK_IN_PRICING` to `packages/pricing` (the only place the number lives) and a
  `calculateLockInPrice()` to `src/lib/price-utils.ts` returning the same
  `{ nights, basePrice, touristTax, total }` shape the nightly code and the Stripe metadata use, with
  `touristTax: 0` and `basePrice = total = weekPrice`.
- **Week logic**: one pure module, `src/lib/lock-in.ts`, owns the rules: the first offerable Monday,
  the 12-week list (as `"yyyy-MM-dd"` calendar-day strings), availability per week via the existing
  `isValidDateRange(monday, nextMonday, mergeDateRanges(bookings))`, and the server-side week
  validator. The page and the server action both call it, so they cannot disagree.
- **Server**: refactor the body of `submitBooking` into a private (non-exported) checkout core in the
  same `"use server"` file, parameterised by product (`"nightly" | "lock-in"`). `submitBooking` keeps
  its exact signature and delegates with `"nightly"` (byte-identical behaviour, existing tests pass
  untouched). A new exported sibling `submitLockIn(roomType, checkIn, checkOut, prevState, formData)`
  first runs `validateLockInWeek` (Monday, on or after 2026-11-02, exactly +7 days, not in the past),
  rejecting with a guest-facing error and no Stripe call, then delegates to the core with
  `"lock-in"`. The core branches only where the products differ: price, line items (one item, no
  tourist-tax item), product name/description, `cancel_url` (`/lock-in/{roomType}`). The contact
  validation, `checkAvailability`, guest-contact upsert, metadata keys and pending-row insert are
  shared, not copied. `checkAvailability` stays private: exporting it from a `"use server"` file would
  publish it as a callable endpoint.
- **UI**: reuse rather than fork. Extract the presentational pieces `BookingEngineExpanded` already
  contains into shared components (`BookingSummaryRow`: nights, person stepper, total, optional tourist
  tax; `BookingGuestForm`: name, email, phone, WhatsApp opt-in, hidden personCount, the two alerts,
  close/book buttons), have `BookingEngineExpanded` render them with identical DOM, and compose them
  again in a new `LockInEngineExpanded` wired to `submitLockIn`. Extract the room page layout and
  `ROOM_CONTENT` (pure data plus identical JSX that differ only in tabs and the engine slot) into a
  shared `RoomPage` server component used by both routes. Extract the Sentry error boundary +
  Suspense from `GuardedBookingEngine` into an `EngineGuard` both engines use.
- **Today**: the week list depends on the current date, and under `cacheComponents` a clock read in a
  prerendered scope fails the build (`next-prerender-current-time`) or, worse, freezes "today" at
  build time. The lock-in server engine therefore `await connection()` before reading the clock and
  `getAvailability`, which makes it a request-time Suspense hole inside an otherwise static page (the
  skeleton is the prerendered fallback). It passes the client only calendar-day strings plus a
  boolean per week.
- **Confirmation**: extract the price block of `booking/confirmation/page.tsx` into a small
  `PriceBreakdown` component that omits the tourist tax row when `tourist_tax` is `0`, so it can be
  browser-tested.

## Relevant Files

Use these files to implement the feature:

- `README.md`, `AGENTS.md` - repo conventions (yarn only, conventional commits, turbo filters).
- `.adw/project.md` - workspaces, ports, test layers, validation commands, review paths.
- `docs/conditional-docs.md` - documentation index; add the feature doc entry under `## apps/website`.
- `apps/website/AGENTS.md` - calendar days as strings, availability parity between server and UI,
  which test layers gate.
- `apps/website/ENGINEERING.md` - availability, booking persistence, why pages render the way they do.
- `apps/website/app_docs/nextjs-patterns-guide.md` - routes, Server Components, Server Actions.
- `apps/website/app_docs/data-fetching-client.md` - reading data in a Server Component.
- `apps/website/app_docs/component-patterns-guide.md` - extracting shared components.
- `apps/website/app_docs/client-form-guide.md` and `form-re-render-strategy.md` - `useActionState`
  form, re-keyed inputs.
- `apps/website/app_docs/zod-validation-guide.md` - validating untrusted Server Action arguments.
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy (no em-dashes).
- `apps/website/app_docs/testing/unit_test_spec_format.md`,
  `apps/website/app_docs/testing/component_test_spec_format.md`,
  `apps/website/app_docs/testing/e2e_example.md` - test formats.
- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md` - why the Suspense
  fallback is `BookingEngineSkeleton` and not `null`.
- `apps/website/app_docs/feature-4d0d9d75-blog-booking-return-link.md` - `submitBooking` arguments,
  `success_url`/`cancel_url` contract.
- `apps/website/app_docs/feature-e259222e-room-switcher-calendar-reset.md` - state seeded from props
  on mount, room switch remounts.
- `apps/website/app_docs/feature-f72316fa-booking-og-metadata.md` - `generateMetadata` on
  `/booking/[type]`, prerendering of both rooms (must stay prerendered after the `RoomPage` extraction).
- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md` - browser tests that gate.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`,
  `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`,
  `node_modules/next/dist/docs/01-app/02-guides/streaming.md`,
  `node_modules/next/dist/docs/01-app/02-guides/redirecting.md` - read before route work (repo root
  `node_modules`).
- `packages/pricing/src/index.ts` - single source of truth for prices; add `LOCK_IN_PRICING` only.
- `apps/website/src/lib/price-utils.ts` - nightly price; add `calculateLockInPrice`.
- `apps/website/src/lib/date-utils.ts` - `toCalendarDay`, `fromCalendarDay`, `mergeDateRanges`,
  `isValidDateRange` (reused, not changed).
- `apps/website/src/lib/availability.ts` - `getAvailability(roomType)` (reused, not changed).
- `apps/website/src/app/(main)/booking/[type]/actions.ts` - `submitBooking`, `checkAvailability`;
  refactored into a shared private core plus the new `submitLockIn`.
- `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts` - existing tests, must
  pass untouched; its mock setup is the model for the lock-in action tests.
- `apps/website/src/app/(main)/booking/[type]/page.tsx` - layout and `ROOM_CONTENT` to extract;
  `generateMetadata` stays here.
- `apps/website/src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts` - must pass untouched.
- `apps/website/src/app/(main)/booking/page.tsx` - redirect pattern for `/lock-in`.
- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.tsx` (+ its browser test) -
  error boundary and Suspense to extract into `EngineGuard`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngine.tsx` - server engine pattern.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` (+ its browser test) -
  source of the extracted summary row and guest form; DOM must stay identical.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` - collapsed row, scroll into view,
  expand/close, `BOOKING_UNAVAILABLE_COPY` error state.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` - Suspense fallback.
- `apps/website/src/app/(main)/booking/confirmation/page.tsx` - tourist tax row (around line 133).
- `apps/website/src/app/ui/Header.tsx` - nav links.
- `apps/website/src/app/globals.css` - `booking-*` classes; the week grid styles go next to them.
- `apps/website/src/app/api/webhook/stripe/route.ts` - reads the metadata keys back; must not change.
- `apps/website/e2e/booking-flow.integration.spec.ts` - model for the lock-in Playwright spec.
- `knip.json` - website entry/project globs; every new export must be used.

### New Files

- `apps/website/src/lib/lock-in.ts` - `LOCK_IN_FIRST_CHECK_IN`, `LOCK_IN_WEEKS_SHOWN`,
  `getLockInWeeks`, `classifyLockInWeeks`, `validateLockInWeek`.
- `apps/website/src/lib/__tests__/lock-in.unit.test.ts` - week generation, availability, validator.
- `apps/website/src/lib/shared/room-content.ts` - `ROOM_CONTENT` moved out of the booking page.
- `apps/website/src/app/(main)/booking/[type]/ui/RoomPage.tsx` - shared room page layout (Server
  Component) with `tabs`, `type` and an `engine` slot.
- `apps/website/src/app/(main)/booking/[type]/ui/EngineGuard.tsx` - Sentry `ErrorBoundary` +
  `Suspense` with `BookingEngineSkeleton` fallback, wrapping `children`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingSummaryRow.tsx` - nights / persons / total /
  optional tourist tax row.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingGuestForm.tsx` - the guest `<form>`.
- `apps/website/src/app/(main)/booking/[type]/__tests__/lock-in-action.unit.test.ts` - `submitLockIn`
  validation and pricing.
- `apps/website/src/app/(main)/lock-in/page.tsx` - redirect to `/lock-in/room1`.
- `apps/website/src/app/(main)/lock-in/[type]/page.tsx` - the lock-in route.
- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInEngine.tsx` - async Server Component:
  `connection()`, availability, weeks.
- `apps/website/src/app/(main)/lock-in/[type]/ui/GuardedLockInEngine.tsx` - `EngineGuard` around it.
- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInClient.tsx` - `'use client'`: selected week
  state, renders the grid and, once a week is picked, `LockInEngineExpanded`.
- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInWeekGrid.tsx` - `'use client'` presentational
  grid of week cards.
- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInEngineExpanded.tsx` - `'use client'`:
  `useActionState(submitLockIn)`, summary row (7 nights, persons, week price, no tax), guest form.
- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInClient.browser.test.tsx` - grid and form.
- `apps/website/src/app/(main)/booking/confirmation/ui/PriceBreakdown.tsx` - price rows.
- `apps/website/src/app/(main)/booking/confirmation/ui/PriceBreakdown.browser.test.tsx`.
- `apps/website/e2e/lock-in-flow.integration.spec.ts` - Playwright: page renders the grid, a week
  goes to (mocked) Stripe.
- `apps/website/app_docs/feature-4278a071-lock-in-week-booking.md` - feature doc (document phase).

## Implementation Plan

### Phase 1: Foundation

Price constant, price helper and the pure week module with its unit tests. Nothing user-visible
changes; everything after builds on these.

### Phase 2: Core Implementation

The server action refactor (shared private core, `submitLockIn`) with its unit tests, then the UI
extractions (`BookingSummaryRow`, `BookingGuestForm`, `EngineGuard`, `RoomPage`, `ROOM_CONTENT`)
verified by the existing browser and unit tests still passing untouched, then the new lock-in
components and route.

### Phase 3: Integration

Header link, confirmation page tourist-tax row, styles, the Playwright spec, documentation, review
screenshots and the full validation run.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the documentation

- Read `apps/website/AGENTS.md`, `apps/website/ENGINEERING.md` and the `app_docs` files listed in
  Relevant Files, plus `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`
  and `.../02-guides/server-actions.md` (at the repo root `node_modules`).

### 2. Add `LOCK_IN_PRICING` to `packages/pricing`

- In `packages/pricing/src/index.ts`, below `ROOM_PRICING` (unchanged), add:
  ```ts
  /**
   * Lock-in: one room for a fixed Monday-to-Monday week. Flat price, no
   * tourist tax. 525 is a placeholder (7 x 75) until the owner sets it.
   */
  export const LOCK_IN_PRICING = {
    /** Price of the whole week in euros */
    weekPrice: 525,
    /** Currency code */
    currency: "EUR",
    /** Nights in a lock-in week */
    nights: 7,
  } as const;
  ```
- No test: a constant. It is exercised by the pricing and action tests below.

### 3. Add `calculateLockInPrice` to `src/lib/price-utils.ts`

- `export function calculateLockInPrice(): { nights: number; basePrice: number; touristTax: number; total: number }`
  returning `{ nights: LOCK_IN_PRICING.nights, basePrice: weekPrice, touristTax: 0, total: weekPrice }`.
  Person count does not enter it; say so in the doc comment.
- Extend `src/lib/__tests__/price-utils.unit.test.ts` (append a `describe`, do not edit existing
  cases): total equals `LOCK_IN_PRICING.weekPrice`, `touristTax` is 0, `nights` is 7.

### 4. Create `src/lib/lock-in.ts`

- Constants: `LOCK_IN_FIRST_CHECK_IN = "2026-11-02"` (a Monday) and `LOCK_IN_WEEKS_SHOWN = 12`.
- `type LockInWeek = { checkIn: string; checkOut: string }` (calendar days).
- `getLockInWeeks(today: Date, count = LOCK_IN_WEEKS_SHOWN): LockInWeek[]`: start at
  `max(startOfDay(today), fromCalendarDay(LOCK_IN_FIRST_CHECK_IN))`, move forward to the next Monday
  if it is not one (date-fns `isMonday` / `nextMonday`; a Monday "today" is kept), then emit `count`
  weeks of `addDays(monday, 7 * i)` / `+7`, each through `toCalendarDay`. Never `new Date("yyyy-MM-dd")`.
- `classifyLockInWeeks(weeks: LockInWeek[], bookings: DateRange[]): (LockInWeek & { available: boolean })[]`:
  `const blocked = mergeDateRanges(bookings)` once, then
  `available = isValidDateRange(fromCalendarDay(w.checkIn), fromCalendarDay(w.checkOut), blocked)`.
  Same predicate as the nightly calendar and `checkAvailability`.
- `validateLockInWeek(checkIn: string, checkOut: string, today: Date): { ok: true } | { ok: false; error: string }`:
  reject when either day does not parse (`Number.isNaN(...getTime())`), check-in is not a Monday,
  check-in is before `LOCK_IN_FIRST_CHECK_IN`, check-out is not exactly `addDays(checkIn, 7)` (compare
  via `toCalendarDay`, so 6 and 8 nights both fail), or check-in is before `startOfDay(today)`. One
  guest-facing message is enough, e.g. "Please pick one of the lock-in weeks shown (Monday to Monday)."
  plus a distinct one for a past week. No em-dashes in copy.
- Shape-check the strings with the existing `"yyyy-MM-dd"` regex/schema if one exists in
  `src/lib/shared/schemas/booking.ts`; otherwise rely on the parse check.

### 5. Unit tests for `src/lib/lock-in.ts`

- Create `src/lib/__tests__/lock-in.unit.test.ts` following `unit_test_spec_format.md`. Use
  `vi.useFakeTimers()` + `vi.setSystemTime` because `isValidDateRange` reads the real clock, and build
  every date with `fromCalendarDay`.
- Week generation:
  - today 2026-10-13: first week `2026-11-02`..`2026-11-09`, length 12, every check-in a Monday
    (`isMonday(fromCalendarDay(...))`), every check-out = check-in + 7, consecutive weeks.
  - today Wed 2026-11-18: first week `2026-11-23` (16-23 Nov not offered).
  - today Mon 2026-11-16: first week `2026-11-16`.
- Availability (system time 2026-10-13):
  - one blocked range `2026-11-05`..`2026-11-06` (one night): week of 2 Nov unavailable, weeks of
    26 Oct (not generated, so test 9 Nov) and 9 Nov available.
  - a blocked range ending on `2026-11-09` (e.g. `2026-11-07`..`2026-11-09`): week of 9 Nov stays
    available (checkout boundary), week of 2 Nov is unavailable.
  - a blocked range starting on `2026-11-09`: week of 2 Nov available.
- Validator: accepts `2026-11-02`/`2026-11-09` with today 2026-10-13; rejects a Sunday check-in
  (`2026-11-01`/`2026-11-08`), 6 nights (`2026-11-02`/`2026-11-08`), 8 nights
  (`2026-11-02`/`2026-11-10`), before start (`2026-10-26`/`2026-11-02`), a past Monday
  (`2026-11-16`/`2026-11-23` with today 2026-11-18), unparseable strings.

### 6. Refactor `submitBooking` into a shared private core and add `submitLockIn`

- In `booking/[type]/actions.ts`, move the body of `submitBooking` into a non-exported
  `async function createCheckout(product: "nightly" | "lock-in", roomType, checkIn, checkOut, source, returnTo, prevState, formData)`.
  `submitBooking` keeps its exact signature and becomes `return createCheckout("nightly", ...)`.
  Every nightly string (error copy, product name, description, URLs, span names, metadata) must stay
  byte-identical; the existing `actions.unit.test.ts` is the proof and must not be edited.
- Branch on `product` only at:
  - price: `product === "lock-in" ? calculateLockInPrice() : calculateTotalPrice(checkInDateOnly, checkOutDateOnly, personCount)`.
  - `line_items`: lock-in has one item, `name` = the date range as today, `description` =
    `` `${roomLabel}: lock-in week, ${nights} nights` ``, `unit_amount` = `Math.round(basePrice * 100)`;
    no tourist-tax item. Nightly unchanged (two items).
  - `cancel_url`: lock-in `${origin}/lock-in/${roomType}`; nightly unchanged (blog return logic).
  - The `"Please select check-in and check-out dates."` message can stay shared.
- Metadata and the `bookings` insert stay one shared code path; for lock-in the values come out as
  `nights: "7"`, `touristTax: "0"`, `basePrice` = `total` = week price, and the row gets `nights = 7`,
  `tourist_tax = 0`, `base_price = total_amount = weekPrice`, `source = 'direct'`. `success_url`
  unchanged.
- Add the exported action:
  ```ts
  export async function submitLockIn(
    roomType: "room1" | "room2",
    checkIn: string | null,
    checkOut: string | null,
    prevState: BookingFormState,
    formData: FormData,
  ): Promise<BookingFormState>;
  ```
  It runs `validateLockInWeek(checkIn, checkOut, new Date())` first (after the null check) and, on
  failure, returns the standard non-success state (`attempt + 1`, echoed `values`, `generalError`,
  `blockedDates: null`) with `captureBookingError`, never touching Stripe, Supabase or availability.
  On success it calls `createCheckout("lock-in", roomType, checkIn, checkOut, "direct", null, ...)`.
  `checkoutSchema` inside the core still validates `roomType` and the day shape.
- Keep `checkAvailability` private and unchanged; both products reach it through the core.
- Avoid duplicating the `values` extraction: it already lives in the core; the early-reject path in
  `submitLockIn` can reuse a small private `readFormValues(formData)` helper extracted from the core.

### 7. Unit tests for `submitLockIn`

- Create `booking/[type]/__tests__/lock-in-action.unit.test.ts` with the same mock setup as
  `actions.unit.test.ts` (copy the mock block; do not modify that file). Pin system time to
  2026-10-13T12:00:00Z.
- Negative cases, each asserting `success: false`, a non-empty `generalError` and
  `mockStripeSessionCreate` not called (and `mockSupabaseFrom` not called): Sunday check-in, 6-night
  range, 8-night range, check-in `2026-10-26`, a past Monday (pin time to 2026-11-18 and submit
  `2026-11-16`/`2026-11-23`).
- Positive case `2026-11-02`/`2026-11-09` with person count 1 and again with 2: Stripe called once,
  `line_items` length 1, `unit_amount === LOCK_IN_PRICING.weekPrice * 100`, description contains
  "lock-in", metadata `nights: "7"`, `touristTax: "0"`, `basePrice` and `total` equal
  `String(LOCK_IN_PRICING.weekPrice)`, every key the webhook reads present, `cancel_url` ends with
  `/lock-in/room1`, `success_url` same shape as nightly; the inserted row has `nights: 7`,
  `tourist_tax: 0`, `base_price` = `total_amount` = week price, `source: "direct"`.
- Availability: a lock-in week with one blocked night from `mockGetAvailability` is rejected with the
  conflict message and no Stripe call (proves the shared `checkAvailability` runs).

### 8. Extract `BookingSummaryRow` and `BookingGuestForm`

- `BookingSummaryRow` props: `nights: number | null`, `personCount`, `onDecrement`, `onIncrement`,
  `total: number | null`, `touristTax?: number | null` (row of the tax line rendered only when the
  prop is not `undefined`; nightly passes `pricing?.touristTax ?? null` to keep the `--€` text).
  Moves the `.booking-summary-row` JSX verbatim.
- `BookingGuestForm` props: `state: BookingFormState`, `formAction`, `isPending`, `onClose`,
  `hasAvailabilityError`, `bookingError: string | null`, `personCount`. Moves the `<form>` JSX
  verbatim (inputs re-keyed by `state.attempt`, hidden `personCount`, alerts, close/book buttons).
- `BookingEngineExpanded` renders `BookingSummaryRow`, `BookingCalendar`, `BookingGuestForm`, tourist
  tax footnote, in the same order; DOM unchanged. The existing `BookingEngineExpanded.browser.test.tsx`
  and `BookingClient.browser.test.tsx` must pass untouched.
- The person-count state and its +/- handlers (cap 2) move into a small hook
  `usePersonCount()` in `BookingSummaryRow.tsx` so both engines share them.

### 9. Extract `EngineGuard`, `RoomPage` and `ROOM_CONTENT`

- `EngineGuard({ children })`: the Sentry `ErrorBoundary` (fallback `BOOKING_UNAVAILABLE_COPY` +
  `WhatsAppLink`) around `<Suspense fallback={<BookingEngineSkeleton />}>`. `GuardedBookingEngine`
  becomes `<EngineGuard><BookingEngine roomType={roomType} /></EngineGuard>` and keeps its doc comment;
  `GuardedBookingEngine.browser.test.tsx` passes untouched (it mocks `./BookingEngine`).
- Move `ROOM_CONTENT` to `src/lib/shared/room-content.ts`; the booking page imports it
  (`generateMetadata` and `metadata.unit.test.ts` unchanged).
- `RoomPage({ type, tabs, engine })` (Server Component) holds the page JSX from
  `booking/[type]/page.tsx` (TabsMobile, Gallery, TabsDesktop, engine slot, capacity, location,
  description, Airbnb link, WhatsApp line). `BookingTypePage` renders
  `<RoomPage type={type} tabs={bookingTabs} engine={<GuardedBookingEngine roomType={roomType} />} />`.
- Confirm `/booking/room1` and `/booking/room2` still show as prerendered in the build route table.

### 10. Lock-in server engine

- `lock-in/[type]/ui/LockInEngine.tsx` (async Server Component): `await connection()` (from
  `next/server`) first, with a comment saying why (the week list depends on today; a clock read in a
  prerendered scope fails the prerender or freezes the date at build). Then
  `const { bookings, error } = await getAvailability(roomType)`,
  `const weeks = classifyLockInWeeks(getLockInWeeks(new Date()), bookings)` and render
  `<LockInClient roomType weeks hasAvailabilityError={Boolean(error)} />`. Only strings and booleans
  cross to the client.
- `GuardedLockInEngine({ roomType })` = `<EngineGuard><LockInEngine roomType={roomType} /></EngineGuard>`.

### 11. Lock-in client components

- `LockInWeekGrid` (`'use client'`, presentational): props `weeks`, `selectedCheckIn: string | null`,
  `onSelect(week)`. Responsive grid (2 columns on mobile, 3 on desktop) inside `.booking-engine`
  styling. Each card shows the range formatted from `fromCalendarDay` as `d MMM` (`"2 Nov – 9 Nov"`,
  the en dash is a range separator, not an em-dash), "7 nights" and `formatPrice(LOCK_IN_PRICING.weekPrice)`.
  - Available: `<button type="button" className="lock-in-week lock-in-week-available" aria-pressed={selected}>`;
    selected adds `lock-in-week-selected`.
  - Booked: a non-interactive `<div className="lock-in-week lock-in-week-booked" aria-disabled="true">`
    with a "Booked" label instead of the price; never gets `lock-in-week-available`, no `onClick`.
  - If no week is available, a short line pointing to WhatsApp.
- `LockInClient` (`'use client'`): `selected` state (`LockInWeek | null`), container ref with the same
  scroll-into-view on select as `BookingClient`, renders a short intro line ("Lock-in: one week, Monday
  to Monday, {price}"), the grid, and `LockInEngineExpanded` when a week is selected (`key` by
  check-in so a new week resets the form state). Closing clears the selection. Sentry
  `setBookingContext`/`addBookingBreadcrumb` like `BookingClient`. No PostHog events (measurement is
  out of scope).
- `LockInEngineExpanded` (`'use client'`): `useActionState` over a wrapper that calls
  `submitLockIn(roomType, week.checkIn, week.checkOut, prevState, formData)` and on success sets
  `window.location.href = result.url`; on `result.blockedDates` (a conflict) it calls
  `onConflict()` so the parent marks that week booked and clears the selection (keep the error visible
  in the grid area). Renders `BookingSummaryRow` with `nights={7}`, `total={weekPrice}` and no
  `touristTax` prop, the selected range, and `BookingGuestForm`. No tourist tax footnote.

### 12. Lock-in route

- `lock-in/page.tsx`: `redirect("/lock-in/room1")`, same as `booking/page.tsx`.
- `lock-in/[type]/page.tsx`: `generateStaticParams` for room1/room2; `generateMetadata` reading
  `params` only (title `Lock-in week, {room title} - issebya.homes`, description from
  `ROOM_CONTENT`, canonical `${SITE_URL}/lock-in/${type}`, reuse the existing
  `/og/booking-${type}.jpg`); invalid type redirects to `/lock-in/room1`; renders
  `<RoomPage type={type} tabs={lockInTabs} engine={<GuardedLockInEngine roomType={roomType} />} />`
  with tabs pointing at `/lock-in/room1` and `/lock-in/room2`.
- Add `/lock-in/room1` and `/lock-in/room2` to `src/app/sitemap.ts` if that file lists the booking
  routes explicitly.

### 13. Header link

- In `src/app/ui/Header.tsx`, add `<Link href="/lock-in/room1" className={`pb-1 ${isActive("/lock-in") ? "border-b-2 border-black" : ""}`}>Lock-in</Link>`
  after "Booking". `/booking` does not prefix-match `/lock-in`, so the two never both highlight.

### 14. Styles

- In `src/app/globals.css`, next to the `booking-*` rules, add `.lock-in-weeks` (grid),
  `.lock-in-week`, `.lock-in-week-available` (reuse the colours of `calendar-date-available`),
  `.lock-in-week-selected` (reuse `calendar-date-selected`), `.lock-in-week-booked` (reuse
  `calendar-date-blocked`, `cursor: default`). No new colours; same fonts and radii as the booking
  engine.

### 15. Confirmation page tourist tax row

- Extract the `space-y-2 pt-2` price block of `booking/confirmation/page.tsx` into
  `booking/confirmation/ui/PriceBreakdown.tsx` (`basePrice`, `touristTax`, `total`), rendering the
  "Tourist tax" row only when `touristTax !== 0`. Same markup otherwise. The page renders
  `<PriceBreakdown basePrice={booking.base_price} touristTax={booking.tourist_tax} total={booking.total_amount} />`.
- `PriceBreakdown.browser.test.tsx`: `touristTax={0}` renders no "Tourist tax" text; `touristTax={6}`
  renders the row with `€6`.

### 16. Browser test for the lock-in grid and form

- `lock-in/[type]/ui/LockInClient.browser.test.tsx` (component-scoped, modelled on
  `BookingEngineExpanded.browser.test.tsx`): mock `@sentry/nextjs`, `@/lib/sentry-booking`, and the
  actions module (`submitLockIn` as a `vi.fn()`); render `LockInClient` with three weeks, the middle one
  `available: false`.
  - The booked card has text "Booked", is not a button, has no `lock-in-week-available` class, and
    clicking it does not render the guest form.
  - Clicking the first available card renders the guest form (name field visible), the summary row
    shows 7 nights and the week price and no "Tourist tax" text, and the card is `aria-pressed="true"`.
  - Submitting the form calls `submitLockIn` with `"room1"`, that week's `checkIn` and `checkOut`.

### 17. Playwright spec

- `apps/website/e2e/lock-in-flow.integration.spec.ts`, modelled on `booking-flow.integration.spec.ts`
  (same `E2E_MOCK_STRIPE` path, same fixture seeding/cleanup through `createAdminClient()`):
  - `/lock-in` redirects to `/lock-in/room1`; `/lock-in/nope` redirects to `/lock-in/room1`.
  - The grid shows 12 cards, the first starts on a Monday on or after 2 Nov 2026.
  - Seed a confirmed `bookings` row for room1 covering one night inside the first week; that card shows
    "Booked" and is not a button; clean the row up after.
  - Pick an available card, fill the guest form, submit, and assert the mocked Stripe redirect and a
    pending `bookings` row with `nights = 7`, `tourist_tax = 0`, `total_amount` = week price.
  - The header "Lock-in" link is marked active on `/lock-in/room2`.
  - `/booking/room1` still shows the nightly calendar (regression guard).

### 18. Review screenshots

- The review phase opens, at desktop 1920x1080 and mobile 375x667, full page:
  `/lock-in/room1`, `/lock-in/room2`, `/booking/room1` (side by side with lock-in), and
  `/lock-in/room1` after selecting an available week (guest form open).
- What it must show: same layout, tabs, gallery and copy as `/booking/room1`; a grid of 12 week cards
  in place of the calendar, booked cards visibly muted; the "Lock-in" header link underlined on
  lock-in pages and "Booking" underlined on booking pages; with a week selected, the summary row shows
  "7" nights and the week price with no tourist tax line.

### 19. Documentation

- Write `apps/website/app_docs/feature-4278a071-lock-in-week-booking.md` (rules in `lock-in.ts`, the
  shared checkout core, why `connection()`, why no tourist tax, placeholder price) and add an entry at
  the end of `## apps/website` in `docs/conditional-docs.md` (when changing lock-in weeks or price, when
  touching `submitBooking`/`submitLockIn` or the shared checkout core, when the confirmation page's
  price rows change).

### 20. Run the validation commands

- Run every command in `Validation Commands` and fix anything that fails without weakening a test,
  rule or type.

## Testing Strategy

### Unit Tests

- `src/lib/__tests__/lock-in.unit.test.ts`: week generation (13 Oct, Wed 18 Nov, Mon 16 Nov), 12
  consecutive Mondays, one-night block marks only its own week unavailable, checkout-boundary block
  does not block the next week, validator accepts the valid week and rejects Sunday, 6 nights, 8
  nights, 26 Oct, a past Monday, unparseable input.
- `src/lib/__tests__/price-utils.unit.test.ts` (appended): `calculateLockInPrice` total = week price,
  tax 0, 7 nights.
- `booking/[type]/__tests__/lock-in-action.unit.test.ts`: the five rejected inputs never call Stripe or
  Supabase; a valid week for 1 and 2 persons yields one line item at the week price, no tax item, full
  metadata key set with `touristTax: "0"`, lock-in `cancel_url`, a pending row with `nights 7` and
  `tourist_tax 0`; a blocked night inside the week is rejected through `checkAvailability`.
- Existing `actions.unit.test.ts`, `metadata.unit.test.ts` and every booking browser test pass
  unmodified, proving the nightly flow is unchanged.

### Test Coverage

- `lock-in.unit.test.ts` (unit): catches a wrong first week, a started week still offered, a
  non-Monday week, or a partially booked week shown as available; nothing tests week logic today.
- `lock-in-action.unit.test.ts` (unit): catches the server accepting a browser-supplied non-lock-in
  range, charging tourist tax, sending two line items or dropping a webhook metadata key; fails
  without `submitLockIn`.
- `price-utils.unit.test.ts` addition (unit): catches the lock-in total drifting from
  `LOCK_IN_PRICING` or picking up per-person tax.
- `LockInClient.browser.test.tsx` (browser): catches a booked card being clickable or styled as
  available, and the form opening with the wrong week.
- `PriceBreakdown.browser.test.tsx` (browser): catches a "Tourist tax €0" row on a lock-in
  confirmation and a missing row on a nightly one.
- `e2e/lock-in-flow.integration.spec.ts` (Playwright, run by the test phase): catches the route,
  redirects, header link, server/UI availability agreement against the real merged calendar, and the
  pending row written end to end.

### Edge Cases

- Today is a Monday on or after 2 Nov: that week is offered.
- Today is a Sunday right before a Monday: the next day's week is first.
- A booking ending on the Monday check-in day does not block that week; one starting on the Monday
  checkout day does not block the earlier week.
- One blocked night anywhere in the 7 nights makes the week unavailable.
- A feed fails on page load: weeks are still classified from what loaded, the guest form shows the
  "couldn't confirm live availability" warning, and the server re-check fails closed when unverifiable.
- The week is taken between page load and submit: conflict message, that card turns "Booked", no
  Stripe session.
- Browser sends a tampered range (Sunday, 6 or 8 nights, before 2 Nov, past): rejected, no Stripe.
- Person count 1 vs 2: same total.
- Switching room tabs remounts the engine (no stale selection across rooms).
- No available weeks at all: the grid shows only "Booked" cards plus the WhatsApp line.
- Server in UTC and guest in Lisbon: only calendar-day strings cross the boundary, so labels never
  shift.

## Acceptance Criteria

- `/lock-in/room1` and `/lock-in/room2` render with the same layout, tabs, gallery and copy as the
  booking pages; `/lock-in` and an unknown type redirect to `/lock-in/room1`.
- The grid shows 12 Monday-to-Monday weeks starting at the first Monday on or after
  max(today, 2026-11-02), each with range, "7 nights" and the week price; a week with any blocked
  night shows "Booked" and cannot be selected.
- Selecting a week opens the shared guest form; submitting creates a Stripe Checkout Session with one
  line item at `LOCK_IN_PRICING.weekPrice`, no tourist-tax item, metadata with every existing key
  (`touristTax: "0"`, `nights: "7"`, `basePrice` = `total` = week price), `cancel_url`
  `/lock-in/{roomType}`, unchanged `success_url`, and a pending `bookings` row with `nights 7`,
  `tourist_tax 0`, `source 'direct'`.
- The server rejects any range that is not a valid lock-in week, with a guest-facing error and no
  Stripe session.
- The price `525` appears only in `packages/pricing/src/index.ts`.
- The header shows "Lock-in", active on `/lock-in*` only.
- The confirmation page hides the tourist tax row when it is 0 and still shows it for nightly stays.
- The nightly flow, `BookingCalendar`, blog `BookingWidget`, the Stripe webhook and every existing test
  are unchanged; no migration; `ROOM_PRICING` unchanged.
- All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn turbo run typecheck --filter=./apps/website` - types across the refactored action and new components.
- `yarn turbo run typecheck --filter=./packages/pricing` - the new pricing export.
- `yarn turbo run lint --filter=./apps/website` - lint rules (no-secrets, Next rules).
- `yarn prettier --check .` - formatting.
- `yarn knip` - no unused exports or files from the extractions.
- `yarn turbo run test --filter=./apps/website` - unit and chromium browser projects, old and new tests.
- `yarn turbo run build --filter=./apps/website` - Cache Components prerender succeeds (no clock read
  outside the `connection()` hole) and both `/booking/*` and `/lock-in/*` appear in the route table.

## Notes

- No new dependency. date-fns already provides `isMonday`, `nextMonday`, `addDays`.
- `LOCK_IN_PRICING.weekPrice = 525` is a placeholder (7 x 75); the owner sets the real price in
  `packages/pricing` only. `apps/guest-communication-agent` reads `ROOM_PRICING`, which is untouched.
- Lock-ins are indistinguishable from 7-night nightly bookings in the data except by
  `tourist_tax = 0` on a 7-night Monday-to-Monday row; a `product` column is a later measurement task.
- `/lock-in/[type]` renders as Partial Prerender (static shell, request-time engine hole) because of
  `connection()`; the booking pages stay fully prerendered.
- "Today" on the server is server-local midnight (UTC on Vercel). Between 00:00 and 01:00 Lisbon time
  in winter the two calendars agree (Lisbon is UTC+0 in November), so no week is offered or withdrawn
  an hour early in practice.
- Out of scope: analytics/PostHog events, GCA changes, whole-house lock-ins, seasonal prices,
  migrations, changes to the nightly flow.
