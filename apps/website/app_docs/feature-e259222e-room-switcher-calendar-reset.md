# Room switcher remounts the booking engine on switch

**ADW ID:** e259222e
**Date:** 2026-09-20
**Specification:** `specs/issue-79-adw-e259222e-sdlc_planner-fix-room-switcher-calendar.md`

## Overview

In a blog post's inline booking widget, clicking the **room 2** tab flipped the
tab styling and `aria-selected` but left the booking engine underneath showing
room 1's blocked dates, room 1's default check-in/check-out, and any range the
guest had already picked on room 1. A guest could therefore be offered, and
book, dates that are blocked for the room they selected. The fix gives the
rendered tab panel a per-room `key`, so React unmounts the previous room's
engine and mounts the next room's engine with that room's props as its initial
state.

## What Was Built

- A per-room `key` on the `RoomSwitcher` tab panel, turning the room switch
  from a prop update into an unmount plus a mount.
- A docstring amendment in `RoomSwitcher` recording why the `key` is
  load-bearing rather than decorative.
- Two browser regression tests that mount the real `BookingClient` as each
  panel, with genuinely different per-room blocked dates.
- One Playwright test covering the user-visible consequence: a selection made
  on room 1 is gone after switching, and the engine returns collapsed.
- A correction to the widget's existing feature documentation, whose "Only the
  active room is mounted" claim was true of the intent but not of the code.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx`: added
  `key={activeRoom}` to the `<div id="blog-room-panel" role="tabpanel">`
  element, plus a docstring paragraph naming the bug the `key` prevents.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`: added
  module mocks (`next/navigation`, `lib/sentry-booking`, a
  `BookingEngineExpanded` stub that renders the real `BookingCalendar`),
  future-relative per-room `blockedDates` fixtures, and two regression tests.
  The three pre-existing tests are unchanged.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`: added "switching
  rooms resets the engine instead of carrying room 1's state over", and a
  comment recording why this layer asserts the remount rather than differing
  blocked days.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`:
  corrected the Key Changes bullet about mounting and expanded the Testing
  section to match the coverage that now exists.

### Key Changes

- **The panels are the same component type at the same tree position.** Both
  rooms render `ErrorBoundary` > `Suspense` > `BookingEngine` > `BookingClient`
  inside a fixed wrapper, so React's reconciler matched them as one instance
  and updated props. `key={activeRoom}` changes the element's identity and
  forces the remount.
- **`BookingClient` derives its interactive state from props on mount only.**
  `blockedDates`, `checkInDate`/`checkOutDate` (via `resolveInitialCheckDates`)
  and `isExpanded` all come from `useState` initialisers, and one level down
  `BookingCalendar`'s `currentMonth` does too. A prop update leaves every one
  of them at the previous room's value.
- **The `key` sits on the wrapper, not on the panel node.**
  `panels[activeRoom]` is an opaque `ReactNode` handed down from a Server
  Component, so keying the wrapper resets the subtree regardless of that node's
  shape.
- **No prop-sync effect was added to `BookingClient`.** Syncing only
  `blockedDates` would still strand the guest on the other room's month with
  the other room's selection highlighted, and syncing all of it by hand is more
  code that reproduces what one `key` already does. `BookingClient` and
  `/booking/[type]` are untouched.
- **The remount still costs no request.** Both panels are already-resolved
  server payloads in the page's static shell, so re-rendering one from memory
  issues neither an `/api/availability` call nor an RSC round trip. The
  existing "switching rooms issues no request" test still passes.

## How to Use

1. Run the site: `cd apps/website && yarn dev` (the app honours `PORT` and only
   defaults to 3000).
2. Open `http://localhost:<PORT>/blog/welcome-to-issebya-homes`.
3. Scroll to the inline booking widget, click **book** to expand the calendar,
   and pick a check-in and a check-out date.
4. Click the **room 2** tab. The engine comes back collapsed, on room 2's own
   server defaults, showing room 2's blocked days. Nothing from room 1 carries
   over.

## Configuration

None. No new dependency, no environment variable, no route config. Room state
stays component state rather than URL state, so `/blog/[slug]` remains a
Partial Prerender and `/blog` remains static.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the browser regression
  tests. The first asserts the calendar under the room 2 tab disables room 2's
  blocked days and not room 1's; the second asserts a range picked on room 1
  does not survive the switch. Both fail against the unfixed `RoomSwitcher`.
- `yarn workspace website test:integration` runs the Playwright suite,
  including the new remount test and the unchanged no-request test.
- `yarn turbo run build --filter=./apps/website` confirms the route table still
  reports `/blog` static and `/blog/[slug]` as a Partial Prerender.

## Notes

- The change is confined to `apps/website`.
- The browser tests widen the viewport to 1280x900 before clicking: the
  calendar renders two months side by side and hides the second below
  Tailwind's `sm` breakpoint, and every fixture day sits in that second month.
- Fixture days are derived from `startOfDay(new Date())` so they can never go
  stale, and the blocked ranges are read start-inclusive and end-exclusive, so
  the assertions target a middle night that can never be re-read as a legal
  check-out.
- The E2E test deliberately does not assert differing blocked days.
  `getAvailability` is a `"use cache"` function with `cacheLife("minutes")`,
  prewarmed at dev-server boot, so making the two rooms differ end to end would
  mean seeding the shared local database and adding an E2E-only cache-busting
  route. That property is proved one layer down instead.
- The dev iCal fixtures under `apps/website/public/dev-ical/` describe dates in
  early 2026 and are entirely in the past, so both rooms look identically wide
  open at runtime. Refreshing them was out of scope here, and it is why the
  browser test supplies its own per-room data.
