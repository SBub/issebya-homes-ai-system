# Lock-in: one-week Monday-to-Monday stays

**Specifications:**

- specs/issue-232-adw-4278a071-sdlc_planner-lock-in-week-booking.md
- specs/patch/patch-adw-4278a071-lock-in-default-country-code.md

## Overview

From 2 Nov 2026 the property sells lock-ins: one room for a fixed week, check-in Monday, check-out the following Monday (7 nights), at a flat week price with no tourist tax. `/lock-in/[type]` (`room1`, `room2`) looks like `/booking/[type]` but replaces the free date calendar with a grid of 12 week cards. The nightly flow is unchanged.

## How it works

Week rules live in one pure module that both the page and the Server Action call, so they cannot disagree. Weeks travel as `"yyyy-MM-dd"` calendar-day strings, never `Date`s.

- `packages/pricing/src/index.ts`: `LOCK_IN_PRICING` (`weekPrice`, `currency`, `nights: 7`). The only place the price lives. `525` is a placeholder (7 x 75) until the owner sets the real figure.
- `src/lib/price-utils.ts`: `calculateLockInPrice()` returns the same `{ nights, basePrice, touristTax, total }` shape as the nightly code, with `touristTax: 0` and `basePrice = total = weekPrice`. Person count does not enter it.
- `src/lib/lock-in.ts`: `getLockInWeeks(today)` lists 12 weeks from the first Monday on or after `max(today, 2026-11-02)` (a Monday "today" is kept, a started week is never offered). `classifyLockInWeeks` marks a week available only when all 7 nights are free, using the same merge and `isValidDateRange` predicate as the nightly calendar. `validateLockInWeek` is the server-side check: Monday, on or after 2026-11-02, exactly +7 days, not in the past.
- `src/app/(main)/booking/[type]/actions.ts`: `submitBooking` now delegates to a private `createCheckout(product, ...)` and keeps its signature and behaviour. The new exported `submitLockIn` runs `validateLockInWeek` first (a tampered range gets a guest-facing error and never reaches availability, Supabase or Stripe), then calls the core with `"lock-in"`. The core branches only on price, line items (one item, no tourist-tax item), and `cancel_url` (`/lock-in/{roomType}`). Contact validation, the availability re-check, guest contact upsert, metadata keys and the pending `bookings` row are shared, so a lock-in row has `nights 7`, `tourist_tax 0`, `source 'direct'`. `checkAvailability` and the core stay private: every export of a `"use server"` file is a callable endpoint.
- `src/app/(main)/lock-in/[type]/page.tsx` and `lock-in/page.tsx`: the route (`/lock-in` and unknown types redirect to `/lock-in/room1`), metadata, and the layout via `RoomPage`.
- `lock-in/[type]/ui/LockInEngine.tsx`: async Server Component. It calls `await connection()` before reading the clock and availability: the week list depends on today, and a clock read in a prerendered scope fails the build or freezes the date at build time. This makes it a request-time Suspense hole in an otherwise static page. Only strings and booleans cross to the client.
- `lock-in/[type]/ui/LockInClient.tsx`, `LockInWeekGrid.tsx`, `LockInEngineExpanded.tsx`: the grid (available weeks are buttons, booked weeks are non-interactive "Booked" cards), selected-week state, and the guest form wired to `submitLockIn`. A conflict on submit marks that week booked. The form's country code is seeded from `splitPhoneNumber("").countryId` (Portugal), the same default as the nightly form.
- `booking/[type]/ui/BookingSummaryRow.tsx` (with `usePersonCount`), `BookingGuestForm.tsx`, `EngineGuard.tsx`, `RoomPage.tsx` and `src/lib/shared/room-content.ts`: pieces extracted from the nightly flow and shared by both products; the nightly DOM is identical.
- `booking/confirmation/ui/PriceBreakdown.tsx`: price rows of the confirmation page; the tourist-tax row is hidden when it is `0`.
- `src/app/ui/Header.tsx`, `src/app/sitemap.ts`, `src/app/globals.css`: "Lock-in" nav link (active on `/lock-in*` only), sitemap entries, and the `lock-in-week*` styles reusing the calendar colours.

## How to Use

1. Open `/lock-in/room1` or `/lock-in/room2` (or the "Lock-in" header link).
2. Pick an available week card. Booked cards cannot be selected.
3. Fill in the guest form and submit; the guest is sent to Stripe Checkout with one "lock-in week" line item.

To change the price, edit `LOCK_IN_PRICING.weekPrice` in `packages/pricing/src/index.ts` only. To change the start date or the number of weeks shown, edit `src/lib/lock-in.ts`.

## Configuration

No new environment variables or migrations. Local Stripe mocking follows the nightly flow (`E2E_MOCK_STRIPE`).

## Testing

- `src/lib/__tests__/lock-in.unit.test.ts`: week generation, availability boundaries, validator.
- `src/lib/__tests__/price-utils.unit.test.ts`: `calculateLockInPrice`.
- `booking/[type]/__tests__/lock-in-action.unit.test.ts`: `submitLockIn` rejections, pricing, metadata, pending row.
- `lock-in/[type]/ui/LockInClient.browser.test.tsx` and `booking/confirmation/ui/PriceBreakdown.browser.test.tsx`: grid, form, tourist-tax row.
- `e2e/lock-in-flow.integration.spec.ts`: redirects, grid, booked card, mocked Stripe redirect and pending row.

## Notes

- `/lock-in/[type]` renders as Partial Prerender (static shell, request-time engine) because of `connection()`; `/booking/*` stays fully prerendered.
- Lock-ins are distinguishable in the data from 7-night nightly bookings only by `tourist_tax = 0` on a Monday-to-Monday row; a `product` column is a later task.
- "Today" on the server is server-local midnight (UTC on Vercel), which agrees with Lisbon in November.
- Out of scope: analytics events, guest-communication-agent changes, whole-house lock-ins, seasonal prices.
- Touches the nightly booking flow only through the extractions above; see `feature-675f0da1-restore-booking-engine-skeleton.md` and `feature-4d0d9d75-blog-booking-return-link.md` for the pieces it reuses.
