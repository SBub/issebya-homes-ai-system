# Bug: Blog booking widget shows room 1's calendar after switching to room 2

## Metadata

issue_number: `79`
adw_id: `a1ab9657`
issue_json: `{"number":79,"title":"Blog booking widget: switching rooms does not update the calendar"}`

## Bug Description

In a blog post's inline booking widget (`/blog/a-weekend-in-almocageme`), clicking the
**room 2** tab changes the tab styling and `aria-selected`, but the booking engine below it
keeps showing **room 1's** availability: the same blocked/disabled days, the same
pre-selected default check-in/check-out, and any date range the guest already selected on
room 1.

- **Expected:** the room 2 tab shows room 2's blocked dates and room 2's server-computed
  default nights, with no date selection carried over from room 1.
- **Actual:** the panel keeps room 1's blocked dates, room 1's default dates and room 1's
  in-progress selection. Only `roomType` itself changes, so the guest can be offered — and
  can submit — a date range that is not bookable for the room they picked.

The standalone `/booking/room1` and `/booking/room2` pages are unaffected: they are separate
routes, so the engine mounts fresh on each.

## Problem Statement

`RoomSwitcher` is supposed to unmount the inactive room's booking engine and mount the
active one, but React reconciles the two panels as the same component instance, so the
engine is merely re-rendered with new props. `BookingClient` derives `blockedDates`,
`checkInDate` and `checkOutDate` from its props exactly once, on mount, so a re-render
without a remount leaves all three stale. The two behaviours together produce a tab
switcher that visibly switches but functionally does not.

A second, equally important problem: the existing test suite asserted only that switching
is _cheap_ (`"switching rooms issues no request"`) and that `aria-selected` follows the
active tab. Nothing asserted that switching is _correct_, which is why a switcher that
never switches passed a green suite.

## Solution Statement

Give the rendered panel a `key` tied to the active room in
`apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx`, so React unmounts the previous
room's engine and mounts the new one. A fresh mount re-runs `BookingClient`'s `useState`
initialisers against the new props, which is exactly the behaviour the component's own
docstring already claims ("Only the active room is rendered... The cost is that unmounting
drops any date selection, which is also the behaviour we want"). One line, no new state, no
fetch, no URL change, no change to `BookingClient`, `getAvailability`, the checkout path or
the static-rendering characteristics of `/blog/[slug]`.

**Deliberately NOT also making `BookingClient` resilient to `blockedDates` changing without
a remount.** The issue asks for the choice to be stated, and the choice is the `key` alone,
for three reasons:

1. `BookingClient`'s contract is "seed from props once, then the state belongs to the
   guest". A prop-sync `useEffect` (or a `useState`-during-render reset keyed on
   `blockedDates`) would re-fire on any future re-render that hands it a new array
   identity — `blockedDates` is a freshly-built `DateRange[]` from `mergeDateRanges`, so
   identity is never stable — and would silently wipe a guest's half-finished selection
   mid-interaction. That is a worse bug than the one being fixed.
2. `apps/website/app_docs/nextjs-patterns-guide.md` and the repo's no-unnecessary-effects
   stance both push derived-on-mount state to be reset by remounting, not by an effect. The
   file already documents `isExpanded`, `checkInDate` and `checkOutDate` as lazy
   initialisers chosen precisely to avoid a sync effect.
3. Only one caller renders two engines in one position. Hardening the callee against a
   caller mistake that exists in exactly one place, and is fixed by one word there, is not
   the minimal fix.

`updateAvailability` (the post-`dates_unavailable` refresh path) stays the one and only way
`blockedDates` changes without a remount, which is correct: that path clears the selection
itself.

## Steps to Reproduce

1. `yarn workspace website dev:next` (or `yarn dev`) and open
   `http://localhost:3000/blog/a-weekend-in-almocageme`.
2. Arrange availability that differs between the rooms — with the shipped
   `public/dev-ical/*.ics` fixtures both rooms currently block only dates in the past, so
   the two calendars look identical and the bug is invisible. Insert a `confirmed` row in
   the `bookings` table for `room_type = 'room2'` on a future window (e.g. today+20 to
   today+23) and bust `getAvailability`'s cache (see "Notes" — the `"use cache"` tag is
   warmed at dev-server boot).
3. On the **room 1** tab, click "Book selected dates" to expand the calendar and note that
   the seeded window is selectable (enabled buttons).
4. Click the **room 2** tab.
5. Observe: the panel stays expanded with room 1's selection intact, and the seeded room 2
   window is still shown as available. Reloading the page and landing on room 2 via
   `/booking/room2` shows it correctly blocked, proving the data is right and the switch is
   wrong.

Faster, data-free reproduction of the same root cause: on room 1, expand the calendar and
select a date range, then click the room 2 tab. The engine stays expanded with the room 1
range still selected. A genuine remount would collapse it back to the room 2 defaults.

## Root Cause Analysis

Two facts combine, and neither alone would be visible.

**1. `RoomSwitcher` re-renders the panel instead of remounting it.**
`apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` renders
`{panels[activeRoom]}` inside a fixed `<div id="blog-room-panel">`. `panels.room1` and
`panels.room2` are structurally identical element trees built by the same
`roomEngine(roomType)` helper in `BookingWidget.tsx` — same `ErrorBoundary`, same
`Suspense`, same `BookingEngine` component type, same position in the children array, no
`key` on either. React's reconciler matches by type and position, so it treats them as the
same instance and performs a props update, not an unmount/mount. All client state below
that point survives.

**2. `BookingClient` derives its state from props on mount only.**
In `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`:

- `const [blockedDates, setBlockedDates] = useState<DateRange[]>(initialBlockedDates)` —
  the argument is read on the first render only. The only other writer is
  `updateAvailability`, called after a `dates_unavailable` checkout retry.
- `checkInDate` / `checkOutDate` are seeded by lazy initialisers calling
  `resolveInitialCheckDates(...)`, again once.
- `isExpanded` is seeded from `Boolean(initialPhone)`, again once.

There is no effect syncing any of them from props, by design.

The proof that it is an update rather than a remount is already in the file: the effect at
`BookingClient.tsx:113` depends on `[roomType]` and does fire on every switch
(`setBookingContext({ roomType })`). The new `roomType` arrives; everything derived from the
other props does not. Downstream, `BookingCalendar` receives the stale `blockedDates` and so
computes stale `disabled` / `calendar-date-blocked` state, and `isValidDateRange` in
`BookingClient.validateRange` validates the guest's selection against the wrong room.

**Why the tests missed it.** `e2e/blog-booking-flow.integration.spec.ts`'s
`"switching rooms issues no request"` asserts a _performance_ property (no
`/api/availability` fetch, no `_rsc=` round trip) which the bug does not violate — in fact
the bug makes it trivially true. `RoomSwitcher.browser.test.tsx` swaps two bare `<p>` stand-ins
whose text content differs, so a props update alone is enough to make its assertions pass;
the stand-ins hold no state, so the missing remount is unobservable to them. The suite
tested the switcher against panels that could not possibly reveal the defect.

## Relevant Files

Use these files to fix the bug:

- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` — **the fix site.** Renders
  `{panels[activeRoom]}` with no key. Its docstring already states the intended
  unmount-on-switch semantics, so the docstring needs a sentence about the mechanism that
  now enforces them.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` — **the test gap.**
  Currently uses stateless `<p>` stand-ins. Gets the new regression test.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` — read-only context: builds both
  rooms' nodes from one `roomEngine(roomType)` helper, which is why the two trees are
  structurally identical and reconcile as one instance. Do not change.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` — read-only context:
  the derive-once state (`blockedDates`, `checkInDate`, `checkOutDate`, `isExpanded`) that
  goes stale. **Must not change**, so `/booking/[type]` cannot regress.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` — read-only
  context: holds `BookingCalendar`, so the calendar is only reachable after clicking
  "Book selected dates". Imports the real `submitBooking` Server Action, which the new
  browser test must mock.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.tsx` — read-only context:
  renders each day as `<button disabled={!isClickable} aria-label={format(date, "MMMM d, yyyy")}>`
  with a `calendar-date-blocked` class. Those two are what the regression test asserts on.
  Its initial month comes from `findFirstMonthWithAvailability(blockedDates)`, which returns
  the current month whenever any day this month is free, and it renders that month plus the
  next one.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx` and
  `BookingEngineExpanded.browser.test.tsx` — read-only: copy their mock set
  (`@sentry/nextjs`, `@/lib/sentry-booking`, `next/navigation`, `../actions`) for the new
  composition test rather than inventing a new one.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` — gets one added test; its
  existing `"switching rooms issues no request"` test must keep passing unchanged.
- `apps/website/src/lib/availability.ts` — read-only: `"use cache"`, `cacheLife("minutes")`,
  `cacheTag("availability", "availability-${room}")`. **Do not change.**
- `apps/website/src/app/(main)/blog/[slug]/page.tsx` — read-only: must stay free of
  `searchParams` / `cookies()` / `headers()` / `export const dynamic`, so it keeps
  prerendering.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` — the feature doc
  that documents `RoomSwitcher` and its test coverage; gets a short correction.
- `apps/website/app_docs/nextjs-patterns-guide.md` — required reading (conditional-docs:
  Server/Client rendering decisions).
- `apps/website/app_docs/component-patterns-guide.md` — required reading (conditional-docs:
  component changes).
- `apps/website/app_docs/testing/component_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md` — the formats the two tests must follow.
- `apps/website/AGENTS.md` — workspace rules (calendar days are strings; appearance and
  clickability in `getDateClasses` are separate concerns).

### New Files

None. Both tests extend files that already exist, so there is nothing new for `knip` to
flag and no new dependency.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the governing documentation

- Read `AGENTS.md` (repo root) and `apps/website/AGENTS.md`.
- Read `apps/website/app_docs/nextjs-patterns-guide.md` and
  `apps/website/app_docs/component-patterns-guide.md`.
- Read `apps/website/app_docs/testing/component_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md`.
- Read `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` for the
  widget's original design intent.

### 2. Reproduce the defect at the test layer, before touching the fix

- Add the failing browser test described in step 4 **first** and run
  `yarn turbo run test --filter=./apps/website`. Confirm it fails with room 2's tab showing
  room 1's blocked dates. A regression test that has never been seen red proves nothing.

### 3. Fix `RoomSwitcher` so the panel genuinely remounts

- In `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx`, add `key={activeRoom}` to the
  `<div id="blog-room-panel" role="tabpanel" ...>` element that wraps `{panels[activeRoom]}`.
  Keying the wrapper (rather than the `ReactNode` prop, which cannot take a key without
  cloning) makes React discard the whole panel subtree on a room change and mount the new
  room's engine fresh, so `BookingClient` re-runs every `useState` initialiser against the
  new props.
- Keep everything else in the file as it is: no new state, no `useEffect`, no URL reads, no
  change to the tablist markup, the `aria-controls`/`aria-labelledby` wiring or the PostHog
  `room_tab_clicked` capture.
- Extend the existing docstring with one short paragraph naming the mechanism: both panels
  are the same component type at the same position, so without a key React reconciles them
  as one instance and updates props instead of remounting — and `BookingClient` seeds
  `blockedDates`, the default dates and the expanded flag from props on mount only, so the
  guest would keep seeing the previous room's availability. Follow the house comment style
  (explain the why, no code references, no em-dashes).
- Do **not** touch `BookingClient.tsx`, `BookingEngine.tsx`, `BookingWidget.tsx` or
  `availability.ts`.

### 4. Add the regression test that would have caught this (browser layer)

In `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`, add one test that
drives the real composition instead of stateless stand-ins. Keep the three existing tests
untouched.

- Import the real `BookingClient` from `../../booking/[type]/ui/BookingClient` (the same
  relative form `BookingWidget.tsx` already uses to reach that directory) and build the two
  panels as `<BookingClient roomType="room1" ... />` and `<BookingClient roomType="room2" ... />`.
- Add the mocks those modules need, mirroring
  `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx` and
  `BookingEngineExpanded.browser.test.tsx`:
  - `@sentry/nextjs` → `{ startSpan }`
  - the `sentry-booking` module → `setBookingContext`, `addBookingBreadcrumb`,
    `captureBookingError` as `vi.fn()`
  - `next/navigation` → `useSearchParams` returning an empty `URLSearchParams`
  - the booking `actions` module (`../../booking/[type]/actions`) → a `submitBooking`
    `vi.fn()`, because `BookingEngineExpanded` imports the real Server Action and it cannot
    load in the browser pool. Resolve it by the specifier that maps to the same absolute
    file the component imports.
  - `posthog-js` is already mocked at the top of this file; keep that single mock.
  - Do **not** mock `BookingEngineExpanded` or `BookingCalendar`. The calendar is the thing
    under assertion.
- Arrange availability that genuinely differs. Use dates in **next month**, which
  `BookingCalendar` always renders (its initial month is
  `findFirstMonthWithAvailability(blockedDates)`, which returns the current month as long as
  any day this month is free, and it draws that month plus the following one). Build them
  from `startOfMonth(addMonths(new Date(), 1))` with `date-fns` so the test never goes
  stale, and keep the two windows disjoint and clear of each room's default dates:
  - room 1 `blockedDates`: roughly next-month day 5 to day 8
  - room 2 `blockedDates`: roughly next-month day 15 to day 18
  - room 1 `defaultCheckIn`/`defaultCheckOut`: next-month day 1 to day 3, as
    `"yyyy-MM-dd"` calendar-day strings via `toCalendarDay` (never `Date`s, per
    `apps/website/AGENTS.md`)
  - room 2 `defaultCheckIn`/`defaultCheckOut`: next-month day 25 to day 27
  - `error: null`, `pricing: <div data-testid="mock-pricing" />` for both.
- The test body:
  1. Render `<RoomSwitcher room1={...} room2={...} />`.
  2. Click "Book selected dates" to expand room 1's engine, and assert that a day inside
     **room 2's** blocked window (e.g. next-month day 16, by its `MMMM d, yyyy` aria-label)
     is enabled and does not carry `calendar-date-blocked` — room 1 has it free.
  3. Click the `room 2` tab.
  4. Assert the panel came back collapsed ("Book selected dates" visible again, the
     expanded calendar gone). This is the direct observable of the remount and the same
     mechanism that drops a stale date selection.
  5. Click "Book selected dates" again to expand room 2's engine, and assert the same
     next-month day 16 is now `disabled` and carries `calendar-date-blocked`, while a day
     inside room 1's window (e.g. next-month day 6) is enabled and unblocked.
- Against the unfixed component, step 4 fails (the panel stays expanded) and step 5 fails
  (the day is still enabled and unblocked). Against the fix, both pass.
- If `findFirstMonthWithAvailability` ever lands the two rooms on different initial months
  and makes the labels ambiguous, mock it exactly as
  `BookingCalendar.browser.test.tsx` already does (`vi.importActual` spread plus a fixed
  return) rather than navigating months in the test.

### 5. Add the user-visible regression to the Playwright spec

In `apps/website/e2e/blog-booking-flow.integration.spec.ts`, add one test inside the
existing `describe`, modelled on the file's existing tests. It needs no database fixture and
no availability difference, so it stays deterministic on whatever the local data happens to
be:

- Go to `WIDGET_POST`, click "Book selected dates" to expand, and select the existing
  `checkInLabel` / `checkOutLabel` pair the file already computes.
- Click the `room 2` tab.
- Assert the engine came back collapsed: "Book selected dates" is visible again and
  "Confirm booking" is not. Before the fix the engine stays expanded with room 1's
  selection still in place, so this test fails; after the fix it passes.
- Add a short comment saying what it guards: a room switch must remount the engine, because
  the engine derives its blocked dates and its default nights from props on mount only.
- Leave `"switching rooms issues no request"` byte-for-byte unchanged. Place the new test
  after it so the request-counting test keeps starting from a clean page load.
- Do not add an agent-driven `e2e/*.md` journey. This is a deterministic DOM assertion on an
  existing flow, which a Playwright spec covers exactly, and the project's default is specs.

### 6. Verify the standalone booking pages did not regress

- With the dev server up, load `/booking/room1` and `/booking/room2` and confirm each
  expands, shows its own blocked dates and reaches the confirm step. Nothing in
  `BookingClient` changed, and the existing
  `e2e/booking-flow.integration.spec.ts` suite covers this path; run it as part of the
  integration run rather than as a separate manual gate.

### 7. Confirm the post route still prerenders

- Run `yarn turbo run build --filter=./apps/website` and read the route table: `/blog` must
  still be listed as static and `/blog/[slug]` as a Partial Prerender. The fix adds no
  `searchParams`, `cookies()`, `headers()` or `dynamic` export, so this is a confirmation
  step, not a change.

### 8. Correct the feature documentation

- In `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`, amend the
  `RoomSwitcher` bullet and the Testing section: record that the active panel is keyed on
  the room so React remounts the engine (both rooms' nodes are the same component type at
  the same position and would otherwise reconcile as one instance), that this is what makes
  the documented "switching drops the date selection" behaviour real, and that the browser
  and E2E suites now assert the calendar's blocked dates actually change rather than only
  that the switch is cheap.
- No new `docs/conditional-docs.md` entry: the existing
  `feature-fe1ca663-blog-with-booking-widget.md` entry already names
  "When changing `BookingWidget`, `RoomSwitcher`, or anything that renders `BookingEngine`
  outside `/booking/[type]`" as its condition, which covers this change.

### 9. Run the validation commands

- Execute every command in `Validation Commands`, top to bottom, and confirm each exits
  cleanly.

## Test Coverage

Two tests, both of which fail against the unfixed code:

- **`apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`** (browser mode,
  Vitest + Playwright) — the primary regression test. It renders the switcher with two real
  `BookingClient` panels carrying deliberately different `blockedDates`, and asserts that a
  day blocked for room 2 is enabled on the room 1 tab and `disabled` +
  `calendar-date-blocked` on the room 2 tab. This is exactly the correctness property the
  old suite never asserted: the calendar's blocked dates differ between the tabs, not just
  the tab styling. It needs a real DOM (render, click, class and `disabled` inspection), so
  the browser layer is the cheapest one that can prove it; there is no pure input/output
  formulation for "React remounted the subtree", so a `*.unit.test.ts` cannot cover it.
- **`apps/website/e2e/blog-booking-flow.integration.spec.ts`** (Playwright) — one added test
  asserting that a date range selected on room 1 does not survive a switch to room 2: the
  engine comes back collapsed at its own defaults. This is the user-visible half of the same
  fix, on the real statically-rendered post with the real server-supplied availability, and
  it needs no fixture, so it stays deterministic. It catches a regression that reintroduces
  the shared instance even if someone rewrites the browser test's stand-ins.

No unit test is warranted: the defect lives entirely in React's reconciliation of a
component tree, with no pure function to exercise. No agent-driven `e2e/*.md` journey is
warranted either: the behaviour is a deterministic DOM assertion that a Playwright spec
covers in seconds.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

**Reproduce the bug before the fix** (run after step 2, before step 3):

- `yarn turbo run test --filter=./apps/website` - the new `RoomSwitcher` browser test FAILS:
  after clicking the room 2 tab the panel is still expanded and room 2's blocked day is
  still rendered as available. This is the red state that proves the test is load-bearing.

**Validate the fix afterwards:**

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass; the new
  `RoomSwitcher` composition test is now green, and the three pre-existing `RoomSwitcher`
  tests plus every `BookingClient`, `BookingCalendar` and `BookingEngineExpanded` test are
  unchanged and still passing, proving `/booking/[type]` did not regress
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and its route
  table still reports `/blog` as static and `/blog/[slug]` as a Partial Prerender

The Playwright specs, including the new room-switch test and the untouched
`"switching rooms issues no request"` test, are run automatically by the test phase's final
`yarn workspace website test:integration` step.

## Notes

- **One-line fix, deliberately.** The only production change is `key={activeRoom}` on the
  tabpanel wrapper in `RoomSwitcher.tsx`, plus its docstring. Everything else in this plan is
  tests and documentation.
- **Why not also harden `BookingClient`.** Stated in full in the Solution Statement: a
  prop-sync effect would re-fire on every new `blockedDates` array identity (`mergeDateRanges`
  returns a fresh array each render) and wipe a guest's in-progress selection, and only one
  caller in the codebase renders two engines in one position. The `key` is the caller-side
  fix for a caller-side mistake.
- **Keying the wrapper, not the node.** `panels[activeRoom]` is a `ReactNode` prop, so it
  cannot take a key without `cloneElement`. Keying the existing `<div id="blog-room-panel">`
  discards the whole subtree on a room change and is a one-word diff. The `id` and the
  `aria-controls`/`aria-labelledby` pairing are unaffected because the id is a literal.
- **No request is added by the remount.** Both rooms' engines are already-resolved RSC output
  held as props, so remounting replays elements that are already in the page payload.
  `BookingClient` fetches nothing on mount, so the `"switching rooms issues no request"`
  assertion (no `/api/availability`, no `_rsc=`) continues to hold.
- **Visible side effect of the fix, and it is the intended one.** After a switch the engine
  is collapsed at the new room's default dates rather than staying expanded on the previous
  room's selection. This is precisely what the component's docstring already promised, and
  the issue lists dropping the selection as required behaviour, not a regression.
- **The dev iCal fixtures are stale.** Every range in `apps/website/public/dev-ical/*.ics`
  falls in March to June 2026, which is now in the past, so locally both rooms have no future
  blocked dates and the two calendars look identical. This is why the browser test supplies
  its own differing `blockedDates` instead of relying on fixtures, and why the added E2E test
  asserts remount (selection dropped, engine collapsed) rather than a data difference. Do not
  rewrite the `.ics` fixtures to fresh dates as part of this fix: they are shared with the
  other specs, and any absolute date rewritten today goes stale again.
- **If someone does want a data-driven E2E assertion later**, note that `getAvailability` is
  `"use cache"` with `cacheLife("minutes")` and is warmed once at dev-server boot by
  `generateStaticParams`, so seeding a row via `createAdminClient()` alone changes nothing
  on screen. It would need a `revalidateTag("availability-room2", { expire: 0 })` hook, in
  the spirit of the existing E2E-only `POST /api/e2e-ical-mock` route. That is out of scope
  here: it adds a test-only surface to the app for a property the browser test already proves
  deterministically.
- **No new dependency.** `date-fns`, `vitest`, `vitest-browser-react` and `@playwright/test`
  are all already in `apps/website`.
- Do not start a dev server for `telegram-router` or `guest-communication-agent`, and do not
  reset the shared local Supabase instance. Neither is needed: this change is confined to
  `apps/website`.
