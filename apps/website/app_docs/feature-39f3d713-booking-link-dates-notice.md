# Booking link dates notice

**ADW ID:** 39f3d713
**Date:** 2026-09-21
**Specification:** `specs/issue-27-adw-39f3d713-sdlc_planner-booking-link-dates-notice.md`

## Overview

A GCA `send_booking_link` URL carries `?checkIn=&checkOut=`, but the booking
engine silently fell back to the site's own default first-available nights
whenever that range could not be applied. The guest saw dates they never agreed
to, with no explanation. The engine now tells them which dates the link carried
and why those dates are not selected, and when a link's range _is_ applied the
calendar opens on the check-in month so the preselection is visible without
paging.

## What Was Built

- A three-way classification of why a URL date range was rejected:
  `"unreadable"`, `"past"`, `"unavailable"`, or `null` when there was nothing
  to reject.
- A guest-facing notice rendered as the first child of `.booking-engine`,
  above the collapsed date row, naming the link's dates and asking the guest to
  pick new ones.
- Calendar month seeding that prefers an already-selected check-in over the
  first month with any availability.
- Browser coverage for all four notice outcomes plus the no-URL-dates negative
  case, a calendar month test, and two Playwright cases on the real GCA link
  shape.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`: widened
  `resolveInitialCheckDates` to return a `rejection`, added the
  `LinkDateRejection` type and the `describeRejectedLinkDates` copy helper,
  collapsed two duplicate lazy initialisers into one `initialSelection`, and
  rendered the notice.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.tsx`: the
  `initialMonth` memo now returns `startOfMonth(selectedCheckIn)` when a
  check-in is selected, falling back to `findFirstMonthWithAvailability`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx`:
  five cases covering past, unavailable, unreadable (unparseable and inverted),
  valid-future, and no-URL-dates.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.browser.test.tsx`:
  one case proving an October selection beats the July mock.
- `apps/website/e2e/booking-flow.integration.spec.ts`: a `gcaBookingLink()`
  URL builder plus two tests, a past link showing the notice with the engine
  expanded and a free future link preselected with no notice.

### Key Changes

- The accept condition is byte-for-byte what it was: both days parse, check-out
  after check-in, and the stay clears `isValidDateRange`. Only the reporting is
  new, so a URL with no date params renders exactly the DOM it rendered before.
- Classification order is deliberate. Unparseable, half-supplied or inverted
  comes first (there are no days to name in a message), then `isPastDate` on
  the check-in, then the `isValidDateRange` blocked-range overlap.
  `isValidDateRange` folds all three failures into one `false`, which is why
  "past" is asked separately via `isPastDate`.
- The resolution is held in `useState`, not `useMemo`, so a later availability
  refresh through `updateAvailability` can never retroactively change the
  notice for a link the guest already opened.
- The notice reuses the existing `.booking-engine-error` container and
  `text-sm text-red-600` paragraph. No new CSS rule, no new UI primitive, no
  new dependency.
- `role="status"` (implicit `aria-live="polite"`), not `role="alert"`: this is
  a page-load condition the guest can act on at their own pace, and it keeps
  the notice distinguishable from the submission error `BookingEngineExpanded`
  renders with `role="alert"`.
- `BookingCalendar`'s `initialMonth` is consumed only as `useState`'s initial
  argument, so recomputation on a later render is inert and the guest's own
  arrow paging is never overridden.

## How to Use

Nothing to configure. The behaviour is triggered by the URL:

1. Open a booking URL carrying dates, for example
   `/booking/room1?checkIn=2020-01-10&checkOut=2020-01-12&phone=%2B351920742845&source=gca`.
2. If the range is applied, the dates appear in the collapsed row and the
   calendar opens on the check-in's month.
3. If it is not, a notice appears above the date row with one of three
   messages:
   - `The dates in your link (10 Jan 2020 → 12 Jan 2020) are in the past. Please pick new dates on the calendar below.`
   - `The dates in your link (5 Sep 2026 → 7 Sep 2026) are no longer available. Please pick new dates on the calendar below.`
   - `We could not read the dates in your link. Please pick your dates on the calendar below.`
4. The guest picks new dates on the calendar as normal. The notice does not
   auto-dismiss; it stays for the page's lifetime as an explanation of the
   link, not as a live validation error.

## Configuration

None. No environment variable, no feature flag, no new dependency. Everything
used (`format`, `startOfMonth`, `fromCalendarDay`, `isPastDate`,
`isValidDateRange`) was already available.

## Testing

- `yarn workspace website test:browser --run` runs the browser project, which
  holds the primary coverage. `yarn turbo run test` runs the unit project only
  and will not exercise these.
- `yarn turbo run test --filter=./apps/website` for the unit project,
  `lint`, `typecheck` and `build` with the same filter, plus
  `yarn prettier --check .` and `yarn knip`.
- The Playwright cases run as part of `yarn workspace website test:integration`.
  They need no fixture seeding: the past range is rejected whatever the local
  availability says, and the future range is +300 days out, where OTA feeds do
  not publish blocks.

## Notes

- Website side only. Stopping GCA from generating past or unavailable links is
  issue #87, already merged. The two are complementary: #87 makes the notice
  rare, this makes it non-silent when it still happens, for example a week-old
  link whose check-in has since passed, or one whose dates an OTA took in the
  meantime. Nothing in `apps/guest-communication-agent` changed and the URL
  contract in `booking.ts` is byte-identical.
- Half-supplied ranges (only one of the two params) are treated as unreadable.
  No caller in this repo produces one, so it can only come from a truncated or
  hand-edited link.
- An existing browser test, "user sees the exact days named by a GCA booking
  link", hardcodes `checkIn: "2027-07-21"`. It will fall into the new `"past"`
  branch once that day passes. The staleness predates this change and was left
  alone rather than widening the diff; making it relative is worth a separate
  chore.
- `BookingClient` reads `useSearchParams()` behind a `<Suspense>` boundary on
  statically rendered routes, so the notice is computed in the browser and
  introduces no prerender/hydration mismatch around "today".
- Do not introduce `new Date("yyyy-MM-dd")` anywhere in this area, in source or
  tests. Both URL dates and server defaults go through `fromCalendarDay` at
  local midnight, per `apps/website/AGENTS.md`.
