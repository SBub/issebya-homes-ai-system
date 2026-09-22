# Bug: Blog booking widget switches tabs but not the calendar

## Metadata

issue_number: `79`
adw_id: `e259222e`
issue_json: `{"number":79,"title":"Blog booking widget: switching rooms does not update the calendar"}`

## Bug Description

In a blog post's inline booking widget (`<BookingWidget />`, rendered from any
MDX post under `apps/website/src/content/blog/`), clicking the **room 2** tab
changes the tab styling and `aria-selected`, but the booking engine underneath
keeps showing **room 1**'s state: room 1's blocked dates, room 1's default
check-in/check-out, and any date range the guest had already selected on room 1.

Expected: picking a room shows that room's availability, with no date selection
carried over (blocked dates differ per room, so a carried selection can be
unbookable).

Actual: the engine is not re-created. It keeps the state it derived from room
1's props when it first mounted, so a guest can be offered dates that are
blocked for the room they selected, and book them from inside the article.

The standalone `/booking/room1` and `/booking/room2` pages are unaffected: they
are separate routes, so the engine mounts fresh on each navigation.

## Problem Statement

`RoomSwitcher` swaps which of two prerendered `ReactNode` panels it renders, but
does so in a way React treats as a prop update to a single, continuously mounted
component instead of an unmount plus a mount. `BookingClient` derives all of its
interactive state from its props **on mount only**, so a prop update leaves
every piece of that state showing the previous room.

The component's own docstring already states the intended behaviour ("Only the
active room is rendered... unmounting drops any date selection, which is also
the behaviour we want"). The intent is right; the mechanism does not deliver it.

## Solution Statement

Give the rendered tab panel a `key` tied to the active room, so React unmounts
the previous room's engine and mounts the next room's engine with that room's
props as its initial state.

**Chosen: the `key` in `RoomSwitcher` only. Not a prop-sync inside
`BookingClient`, and not both.** Reasons:

- A `key` is the React-sanctioned way to reset all state when an identity
  changes, and it is the only change that produces the behaviour the docstring
  promises: the date selection is dropped rather than migrated.
- A prop-sync inside `BookingClient` would be an incomplete fix. `blockedDates`
  is not the only mount-seeded state: `checkInDate`/`checkOutDate` (seeded via
  `resolveInitialCheckDates`), `isExpanded`, and — one level down —
  `BookingCalendar`'s `currentMonth` (`useState(findFirstMonthWithAvailability(blockedDates))`)
  are all initialised once. Syncing only `blockedDates` would leave the guest on
  a month chosen for the other room, with the other room's selection still
  highlighted. Fixing all of them by hand is strictly more code that reproduces
  what one `key` already does.
- The repo's own guidance (`no-unnecessary-effects`, and the "no useEffect
  needed to sync it" comments already in `BookingClient`) points away from
  adding a props-to-state effect here.
- `/booking/[type]` stays untouched, so it cannot regress: those pages mount
  fresh and are already correct.

Constraints respected: no availability fetch on switch (both panels are still
the same already-resolved server payloads, re-rendered from memory), no URL
state, no `searchParams` in the post route, no change to `getAvailability` or
its cache tags, no change to the checkout path, no change to `BookingClient`.

## Steps to Reproduce

1. `cd apps/website && yarn dev:next` (or `yarn dev`).
2. Open `http://localhost:<PORT>/blog/a-weekend-in-almocageme`.
3. Scroll to the "stay here while you read about it" widget.
4. Click **book** to expand the calendar, then click a check-in and a check-out
   date.
5. Click the **room 2** tab.
6. Observe: the tab styling flips, but the calendar stays expanded with the
   room 1 selection still highlighted, and the disabled/hatched days are still
   room 1's. `aria-selected` says room 2; the engine is room 1's.

Deterministic reproduction lives in the tests added below: with genuinely
different `blockedDates` per room, the room 2 panel renders room 1's disabled
days.

## Root Cause Analysis

Two facts combine.

**1. `RoomSwitcher` never remounts the panel.**
`apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` renders
`{panels[activeRoom]}` inside a fixed `<div id="blog-room-panel">`. Both panel
nodes are the same element type (`ErrorBoundary` > `Suspense` >
`BookingEngine` > `BookingClient`) at the same position in the tree and carry no
`key`, so React's reconciler matches them as the _same_ instance and updates
props instead of unmounting and remounting.

**2. `BookingClient` derives state from props only on mount.**
In `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`:

- `const [blockedDates, setBlockedDates] = useState<DateRange[]>(initialBlockedDates)` —
  `useState`'s argument is used on the first render only. The only other writer
  is `updateAvailability`, called after a `dates_unavailable` checkout retry.
  Nothing syncs it from props.
- `checkInDate` / `checkOutDate` are seeded the same way, through a lazy
  initializer over `resolveInitialCheckDates`.
- `isExpanded` likewise.
- `BookingCalendar`'s `currentMonth` likewise, one level further down.

The `useEffect` keyed on `roomType` (Sentry context/breadcrumb) does fire on
every switch, which is the proof that the component updates rather than
remounts: the new `roomType` arrives, while everything derived from the other
props stays at its mount-time value.

**Why the suite stayed green.** `e2e/blog-booking-flow.integration.spec.ts`'s
"switching rooms issues no request" asserts a _performance_ property (no
`/api/availability` call, no RSC round trip) and a styling property
(`aria-selected`). Nothing asserted the _correctness_ property — that the
engine under the tab is the selected room's engine. The switcher was verified to
be cheap, never to work.

## Relevant Files

Use these files to fix the bug:

- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` — the defect. The
  rendered tab panel needs a per-room `key`; the docstring needs one sentence
  saying the `key` is what makes the documented unmount real.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` — existing
  browser coverage for the switcher; gains the regression test that proves the
  panel's calendar changes with the tab.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` — read only.
  Explains the staleness (mount-seeded `blockedDates`, `checkInDate`,
  `checkOutDate`, `isExpanded`). **Do not modify.**
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.tsx` — read
  only. Source of the observable DOM the regression test asserts on: a date
  button is `disabled` and carries `aria-label="MMMM d, yyyy"`; blocked days
  never get `calendar-date-available`. Also holds the second piece of
  mount-seeded state (`currentMonth`).
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx`
  — the mocking template to copy: `next/navigation`'s `useSearchParams`,
  `lib/sentry-booking`, a stubbed `BookingEngineExpanded`, and a `pricing`
  `ReactNode` stand-in.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` — read only. Confirms
  both panels are built server-side and handed down as props, which is why a
  remount costs no request.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` — holds the
  "switching rooms issues no request" test that must keep passing; gains the
  user-visible remount test.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` — the
  feature's documentation; its "Only the active room is mounted" claim and its
  Testing section need correcting to match reality.
- `apps/website/AGENTS.md`, `apps/website/app_docs/nextjs-patterns-guide.md`,
  `apps/website/app_docs/component-patterns-guide.md`,
  `apps/website/app_docs/testing/component_test_spec_format.md`,
  `apps/website/app_docs/testing/e2e_example.md` — conventions to follow.

### New Files

None. The fix is one attribute; both tests extend existing files.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions before touching anything

- Read `apps/website/AGENTS.md`.
- Read `apps/website/app_docs/nextjs-patterns-guide.md` and
  `apps/website/app_docs/component-patterns-guide.md` (both named as
  constraints by the issue).
- Read `apps/website/app_docs/testing/component_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md` before writing either test.

### 2. Write the failing browser regression test first

Extend `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`. Keep
the three existing tests exactly as they are — they still describe the
switcher's contract with plain stand-in panels.

Add, in the same file, module mocks and one new test that renders the **real**
`BookingClient` as each panel, with **genuinely different `blockedDates` per
room**:

- Mocks (hoisted, `vi.mock`), modelled on `BookingClient.browser.test.tsx`:
  - `posthog-js` — already mocked in this file.
  - `next/navigation` → `{ useSearchParams: () => new URLSearchParams() }`, so
    both engines take the direct-visitor path.
  - `lib/sentry-booking` → `{ setBookingContext: vi.fn(), addBookingBreadcrumb: vi.fn() }`.
    Use whichever specifier form resolves in this project (the `@/lib/...`
    alias is wired through `vite-tsconfig-paths`; the existing booking tests
    use the relative form).
  - `BookingEngineExpanded` → a stub that renders the **real**
    `BookingCalendar` with the `blockedDates`, `checkInDate`, `checkOutDate`
    and `onDateSelect` it was handed. This keeps the assertion on the real
    calendar's real DOM while keeping the booking form, the `submitBooking`
    Server Function and its Stripe/Supabase imports out of the browser test.
    Add a short comment saying exactly that.
- Fixtures: two `DateRange[]` values over **future** days, disjoint from each
  other, computed relative to `startOfDay(new Date())` with `date-fns` so they
  never go stale — e.g. room 1 blocked over days +20..+23 and room 2 blocked
  over days +40..+43. Derive the `aria-label` strings with
  `format(day, "MMMM d, yyyy")`, matching how the existing specs address date
  buttons. Give each room a different `defaultCheckIn`/`defaultCheckOut` too.
- New test, "switching to room 2 shows room 2's blocked dates, not room 1's":
  1. Render `<RoomSwitcher room1={<BookingClient {...room1Props} />} room2={<BookingClient {...room2Props} />} />`.
  2. Click **Book selected dates** to expand room 1's engine.
  3. Assert room 1's blocked day button is `disabled` and room 2's blocked day
     button is **not** disabled. (Navigate months with the "Next month" /
     "Previous month" buttons if the chosen days fall outside the two months on
     screen; pick offsets that keep both in view to avoid that.)
  4. Click the **room 2** tab.
  5. Click **Book selected dates** again (the fix collapses the engine on
     remount, which is the point).
  6. Assert the inverse: room 2's blocked day button is `disabled`, room 1's is
     not.
- Second new test, "a date selected on room 1 does not survive a switch to room 2":
  1. Render as above, expand room 1, click an available check-in and check-out.
  2. Assert the collapsed check-in display shows the clicked day.
  3. Click the **room 2** tab.
  4. Assert the engine is collapsed again (the calendar is gone) and the
     check-in/check-out displays show **room 2's** server defaults, not the
     clicked days.

Run `yarn turbo run test --filter=./apps/website` and confirm **both new tests
fail** against the unfixed `RoomSwitcher`. A test that passes before the fix
proves nothing; stop and correct it if that happens.

### 3. Apply the fix

In `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx`, add `key={activeRoom}`
to the `<div id="blog-room-panel" role="tabpanel">` element, so the whole panel
subtree is unmounted and remounted when the active room changes. (Keying the
wrapper rather than the node inside it is deliberate: `panels[activeRoom]` is an
opaque `ReactNode` handed down from the Server Component, and a key on the
wrapper resets the subtree regardless of that node's shape.)

Amend the docstring's "Only the active room is rendered..." paragraph with one
sentence: both panels are the same component type at the same position, so
without a `key` React would reconcile them as one instance and update props
rather than remount — and `BookingClient` seeds `blockedDates`, the selected
dates and the expanded flag from props on mount only. Name the bug this
prevents, not just the mechanism.

Change nothing else: no `BookingClient` edit, no fetch, no URL state, no route
config.

### 4. Confirm the browser tests now pass

Run `yarn turbo run test --filter=./apps/website`. Both new tests pass, the
three pre-existing `RoomSwitcher` tests still pass, and every booking test is
untouched.

### 5. Extend the Playwright spec with the user-visible remount

Add one test to `apps/website/e2e/blog-booking-flow.integration.spec.ts`, after
"switching rooms issues no request":

- "switching rooms resets the engine instead of carrying room 1's state over":
  1. `page.goto(WIDGET_POST)`.
  2. Click **Book selected dates**, then click the `checkInLabel` and
     `checkOutLabel` date buttons (same locator style the booking test in this
     file already uses: `button:not([disabled])[aria-label="..."]`).
  3. Assert the expanded calendar is on screen (`Confirm booking` visible) and
     the collapsed check-in display shows the clicked day.
  4. Click the **room 2** tab.
  5. Assert `Confirm booking` is no longer visible — the engine remounted
     collapsed — and the check-in display no longer shows the day clicked on
     room 1.

  Before the fix this test fails at step 5: the engine stays expanded with room
  1's selection. Add a comment recording _why_ this spec asserts the remount
  rather than differing blocked dates: `getAvailability` is `"use cache"` with
  `cacheLife("minutes")` and is prewarmed at dev-server boot, so making the two
  rooms' availability genuinely differ end-to-end would mean seeding the shared
  local database **and** adding an E2E-only cache-busting route. The blocked-date
  property is proved deterministically one layer down, in the browser test, with
  real calendar DOM and genuinely different per-room data.

- Do **not** touch the "switching rooms issues no request" test. Re-run it to
  confirm the remount still costs no `/api/availability` call and no `_rsc=`
  round trip: both panels are already-resolved server payloads, so re-rendering
  one from memory issues nothing.
- Do **not** reset or reseed the shared local Supabase instance, and do not add
  fixture dates that collide with the `+10..+13` room 1 window
  `booking-flow.integration.spec.ts` seeds.

### 6. Update the feature documentation

In `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`:

- Under **Key Changes**, correct the "Only the active room is mounted" bullet to
  say the unmount is produced by a per-room `key` on the tab panel, and why
  (the panels are the same component type at the same position, and
  `BookingClient` seeds state from props on mount only).
- Under **Testing**, replace the `RoomSwitcher.browser.test.tsx` sentence with
  what it now covers: the panel swap, `aria-selected`, and that the mounted
  engine's calendar disables the newly selected room's blocked days while
  dropping the previous room's selection. Add the new E2E test to the
  `blog-booking-flow.integration.spec.ts` sentence.

No entry is needed in `docs/conditional-docs.md`: this edits an existing
documented feature rather than adding a new document.

### 7. Confirm the post route is still statically generated

Run `yarn turbo run build --filter=./apps/website` and read the route table:
`/blog` must still be listed as static and `/blog/[slug]` as a Partial
Prerender, exactly as today. Nothing in this change can affect that — no
`cookies()`, `headers()`, `searchParams` or `export const dynamic` was added —
but the issue names it as a contract, so verify it rather than asserting it.

### 8. Run the Validation Commands

Run every command in the `Validation Commands` section, in order, and confirm
each exits clean.

## Test Coverage

Two regression tests, both failing before the fix and passing after it:

1. **`apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`
   (`*.browser.test.tsx`, Vitest browser mode)** — the primary regression test,
   and the cheapest layer that can prove the actual defect. It renders the real
   `BookingClient` for each room with genuinely different `blockedDates`, and
   asserts the real `BookingCalendar` under the room 2 tab disables room 2's
   blocked days and not room 1's, plus that a room 1 date selection does not
   survive the switch. Against the unfixed code the room 2 panel renders room
   1's disabled days and keeps the selection, so both assertions fail. This is
   precisely the assertion the existing suite lacked.

2. **`apps/website/e2e/blog-booking-flow.integration.spec.ts`
   (`apps/website/e2e/*.spec.ts`, Playwright)** — one added test covering the
   user-visible consequence in the real app: a selection made on room 1 is gone
   after switching to room 2, and the engine comes back collapsed. It fails
   before the fix (the engine stays expanded, still holding room 1's dates).
   It deliberately does not assert differing blocked dates; see step 5 for why
   that property is proved at the browser layer instead.

No agent-driven `e2e/*.md` journey: a Playwright spec covers this flow
deterministically, which is this project's default.

No unit test: the defect is React reconciliation identity, which has no
DOM-free expression.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions. All
commands run from the repository root.

- `yarn turbo run test --filter=./apps/website` — **run this at step 2, before
  the fix, and confirm the two new `RoomSwitcher` browser tests FAIL.** That is
  the reproduction. Re-run after step 3 and confirm they pass along with the
  whole suite.
- `yarn prettier --check .` — formatting matches the repo config, so the commit
  hook will not reject it
- `yarn turbo run lint --filter=./apps/website` — lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` — types are sound for the
  workspace
- `yarn knip` — no unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` — unit and browser tests pass,
  proving the bug is fixed with zero regressions
- `yarn turbo run build --filter=./apps/website` — production build succeeds,
  and its route table still reports `/blog` static and `/blog/[slug]` as a
  Partial Prerender
- `yarn workspace website test:integration` — the Playwright suite, including
  the unchanged "switching rooms issues no request" test, the unchanged booking
  flows, and the new remount test. (The test phase runs this as its last step;
  it is listed here because the issue names the no-request test as a contract
  that must keep passing.)

## Notes

- **No new dependencies.** The fix is one JSX attribute; both tests use
  `vitest`, `vitest-browser-react`, `@playwright/test` and `date-fns`, all
  already present in `apps/website`.
- **Why not also make `BookingClient` resilient to prop changes.** Stated in the
  Solution Statement, and worth repeating for the reviewer: doing both was
  considered and rejected. A prop-sync there would either duplicate what the
  `key` already does or, if the `key` were dropped in its favour, leave
  `isExpanded`, the selected dates and `BookingCalendar`'s `currentMonth` stale.
  One mechanism, at the component whose docstring already promised it.
- **The existing dev iCal fixtures under `apps/website/public/dev-ical/`
  describe dates in early 2026 and are entirely in the past.** They contribute
  no future blocked days, so both rooms currently look identically wide open at
  runtime. That is exactly the "fixtures prove nothing" trap the issue warns
  about, and it is why the browser test supplies its own future-relative,
  per-room `blockedDates` instead of leaning on those files. Refreshing the
  fixtures is out of scope here.
- **Do not start a second dev server for `telegram-router` or
  `guest-communication-agent`,** and do not reset the shared local Supabase
  instance. The Playwright config spawns its own `next dev` for
  `apps/website` on this worktree's `PORT`.
- The change is confined to `apps/website`. `telegram-router`,
  `guest-communication-agent` and `packages/pricing` are untouched and need no
  coverage for this bug.
