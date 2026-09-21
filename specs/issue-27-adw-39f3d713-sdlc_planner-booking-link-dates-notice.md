# Bug: GCA booking link silently drops the guest's dates with no notice

## Metadata

issue_number: `27`
adw_id: `39f3d713`
issue_json: `{"number":27,"title":"GCA booking link doesn't preselect dates on the website","body":"Status 2026-09-21: the mechanism originally described (a useEffect in BookingEngine.tsx applying parseISO'd URL dates once useAvailabilityQuery resolved) no longer exists. The booking engine was rebuilt (issue #49 and later): the current equivalent is resolveInitialCheckDates in apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx, seeded via useState lazy initialisers from useSearchParams()'s checkIn/checkOut, parsing through fromCalendarDay (src/lib/date-utils.ts), so the timezone hypothesis is resolved by design (apps/website/AGENTS.md, \"Calendar days are strings\"). Availability is server-computed and passed as blockedDates props; there is no client fetch. What is still true, the actual defect: resolveInitialCheckDates returns the server defaults whenever the URL range is malformed, inverted, in the past or overlaps a blocked range, and nothing tells the guest. They opened a link that said \"5-7 September\" and see other dates preselected, with no message. (The engine does auto-expand when ?phone= is present, so they at least see the calendar.) Deliverable (website side only; the GCA side, never generating a past or unavailable link, is #87): (1) when the URL carries checkIn/checkOut and the range is not applied, show a visible notice inside the booking engine, above the calendar, saying which dates were in the link and why they could not be selected, one of: dates are in the past; dates are no longer available; the link's dates could not be read, and ask the guest to pick new dates; reuse the engine's existing error/notice styling, no new UI kit. (2) When the range is applied, the calendar opens on the check-in month, so the preselection is visible without paging. (3) Nothing else about the engine changes: the ?phone=/guestName/email/source=gca prefill contract from booking.ts in GCA stays byte-identical, calendar days stay yyyy-MM-dd strings, and a URL with no dates behaves exactly as today. Verification: browser tests (BookingClient.browser.test.tsx already mocks useSearchParams): past range -> notice with the \"past\" reason and defaults selected; range overlapping a blocked fixture -> \"no longer available\" notice; malformed (checkIn=foo) -> \"could not be read\"; valid future range -> dates selected, no notice, calendar showing that month. Negative: no URL dates -> no notice element in the DOM. E2E in e2e/booking-flow.integration.spec.ts: /booking/room1?checkIn=<today-30d>&checkOut=<today-28d>&phone=%2B351920742845&source=gca shows the notice and the engine expanded; a future free range is preselected. yarn lint && yarn typecheck && yarn test && yarn knip, yarn workspace website test:browser --run, yarn workspace website test:integration green. Out of scope: changing what GCA sends (#87), the confirmation page, or the /api/availability route."}`

## Bug Description

GCA's `send_booking_link` sends the guest a URL shaped

```
https://www.issebya.com/booking/room2?checkIn=2026-09-05&checkOut=2026-09-07&phone=%2B351920742845&guestName=Sviatlana%20Buben&email=svetaibuben%40gmail.com&source=gca
```

The guest agreed on "5 to 7 September" in WhatsApp, taps the link, and the
booking engine opens with _different_ dates preselected: the site's own
server-computed first-available-nights default. Nothing on the page mentions
the dates from the link, or why they were not used. The guest is left to work
out on their own that the selection in front of them is not the stay they just
negotiated.

Expected: either the link's dates are preselected, or the guest is told, in the
engine itself, which dates were in the link and why they could not be
selected, with a prompt to pick new ones.

Actual: the link's dates are discarded in silence, and the default selection is
presented as if the guest had chosen it.

Secondary symptom: even when the link's dates _are_ applied, the calendar opens
on the first month that has any availability, which is not necessarily the
check-in month. A guest whose stay is three months out sees an empty-looking
calendar and has to page forward to find their own highlighted selection.

## Problem Statement

`resolveInitialCheckDates` in
`apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` is an
all-or-nothing gate: it returns the URL range when the range parses, is
correctly ordered, and passes `isValidDateRange`; in every other case it
returns the server defaults and reports nothing. Three materially different
guest-facing situations (the link's dates are in the past, they have since been
booked by someone else, the params are unreadable) collapse into one silent
fallback that is indistinguishable from "the guest arrived with no dates at
all".

`BookingCalendar` compounds this by seeding its visible month from
`findFirstMonthWithAvailability(blockedDates)` regardless of whether a
selection already exists, so an applied preselection can open off-screen.

## Solution Statement

Keep the existing accept/reject decision exactly as it is (the same parse, the
same `isValidDateRange`, the same fallback to server defaults) and make the
rejection _observable_:

1. `resolveInitialCheckDates` additionally returns _why_ the URL range was
   rejected: `"unreadable"`, `"past"`, or `"unavailable"`, or `null` when there
   was nothing to reject (no URL dates) or the range was applied. The
   classification order matters: unparseable or inverted first, then a check-in
   before today, then an overlap with `blockedDates`.
2. `BookingClient` renders a short notice as the first child of
   `.booking-engine` whenever that reason is non-`null`, reusing the engine's
   existing `booking-engine-error` container and `text-sm text-red-600`
   paragraph. It names the dates the link carried (for the two reasons where
   they are parseable) and asks the guest to pick new dates. Placed above the
   collapsed date row so it is visible whether or not the engine auto-expanded.
3. `BookingCalendar` seeds its initial month from `startOfMonth(selectedCheckIn)`
   when a check-in is already selected at mount, falling back to
   `findFirstMonthWithAvailability` otherwise.

No new dependency, no new UI primitive, no change to what GCA generates, no
change to the `?phone=`/`guestName`/`email`/`source=gca` prefill contract, and
a URL with no date params keeps rendering exactly the DOM it renders today.

## Steps to Reproduce

1. `cd apps/website && yarn dev` (the website has no port contract; it honours
   `PORT` and defaults to 3000).
2. Open `/booking/room1?checkIn=2020-01-10&checkOut=2020-01-12&phone=%2B351920742845&source=gca`
   (any past range; this is what a stale or mis-yeared GCA link looks like, see
   the 2026-09-21 incident in #87).
3. The calendar auto-expands because `?phone=` is present. The collapsed row
   shows the site's default first-available nights, not 10 to 12 January. No
   message anywhere mentions the dates that were in the link.
4. Same result with `?checkIn=foo&checkOut=bar` (unparseable), with
   `?checkIn=2027-07-24&checkOut=2027-07-21` (inverted), and with any future
   range that overlaps a blocked range in the current availability merge.
5. For the secondary symptom, open a _valid_ future link three or more months
   out on a room whose current month has availability: the dates are applied,
   but the calendar opens on the current month and the selection is off-screen.

## Root Cause Analysis

`resolveInitialCheckDates` (`BookingClient.tsx`) is written as a single boolean
funnel:

```ts
if (urlCheckIn && urlCheckOut) {
  const parsedCheckIn = fromCalendarDay(urlCheckIn);
  const parsedCheckOut = fromCalendarDay(urlCheckOut);
  if (
    !Number.isNaN(parsedCheckIn.getTime()) &&
    !Number.isNaN(parsedCheckOut.getTime()) &&
    parsedCheckOut > parsedCheckIn &&
    isValidDateRange(parsedCheckIn, parsedCheckOut, blockedDates)
  ) {
    return { checkIn: parsedCheckIn, checkOut: parsedCheckOut };
  }
}
return { checkIn: defaultCheckIn ? ... : null, checkOut: ... };
```

Its return type carries only the resulting dates, so by construction there is
nowhere for a rejection reason to go, and every caller sees a successfully
resolved selection. `isValidDateRange` (`src/lib/date-utils.ts`) folds three
independent failure modes into one `false`: `checkIn >= checkOut`, `checkIn`
before `startOfDay(new Date())` (evaluated at _click_ time, not at link
generation time, so an entirely well-formed link decays into a rejection the
moment its check-in passes), and any night of the range falling inside a
blocked range. The component cannot tell those apart, so it could not report
them even if it wanted to.

This is not a date-parsing or timezone bug. The original hypothesis about
`parseISO` versus UTC-constructed blocked ranges was fixed by the rebuild:
both sides now go through `fromCalendarDay` / `startOfDay` at local midnight,
per `apps/website/AGENTS.md` ("Calendar days are strings, not `Date`s"). What
remains is purely a missing feedback path: a rejection that produces no
user-visible consequence.

The month symptom has the same shape. `BookingCalendar` computes
`const initialMonth = useMemo(() => findFirstMonthWithAvailability(blockedDates), [blockedDates])`
and seeds `currentMonth` from it, ignoring `selectedCheckIn` entirely. The
prop that says where the guest is actually looking is not consulted when
deciding what to show them.

Note on rendering: `BookingClient` reads `useSearchParams()` and is wrapped in
a `<Suspense>` boundary in both `booking/[type]/page.tsx` and the blog
`BookingWidget`, so on these statically rendered routes the URL params are only
known in the browser. The notice is therefore computed client-side and does not
introduce a prerender/hydration mismatch around "today".

## Relevant Files

Use these files to fix the bug:

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` - owns
  `resolveInitialCheckDates` and the `.booking-engine` wrapper. Both the
  rejection classification and the notice live here.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.tsx` - seeds
  `currentMonth` from `findFirstMonthWithAvailability`; needs to prefer the
  selected check-in's month.
- `apps/website/src/lib/date-utils.ts` - `fromCalendarDay`, `isValidDateRange`,
  `isPastDate`. Read only: the classification reuses these, it does not
  reimplement or change them.
- `apps/website/src/app/globals.css` - already defines
  `.booking-engine-error` (`@apply p-4 text-center`), the container the notice
  reuses. No change expected; read it to confirm no new rule is needed.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` -
  read only, to confirm the existing availability/booking error styling
  (`text-red-500 text-sm`, `role="alert"`) the notice is modelled on and to
  confirm the prefill contract it reads from the URL is untouched.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx` -
  already mocks `next/navigation`'s `useSearchParams`; the four notice cases
  and the negative case go here.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.browser.test.tsx` -
  already mocks `findFirstMonthWithAvailability` and `isPastDate`; the
  opens-on-check-in-month case goes here.
- `apps/website/e2e/booking-flow.integration.spec.ts` - the Playwright spec the
  end-to-end cases are appended to.
- `apps/website/AGENTS.md` - "Calendar days are strings, not `Date`s" and the
  calendar/availability rules that constrain this change.
- `apps/website/app_docs/testing/component_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md` - the house formats for the
  two test layers being extended.
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy.
- `apps/guest-communication-agent/src/agent/tools/booking.ts` - read only, line
  198, to confirm the exact link shape the notice has to explain. Do not change
  this file; the GCA side is #87.

### New Files

None. The fix is confined to two existing components and three existing test
files.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the constraints before touching code

- Read `apps/website/AGENTS.md` in full, in particular "Calendar days are
  strings, not `Date`s" and the `getDateClasses` note.
- Read `apps/website/app_docs/testing/component_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md`.
- Read `apps/website/app_docs/branding-guidelines.md` before writing the
  notice copy.
- Confirm no other caller in the repo puts `checkIn`/`checkOut` on a website
  URL: `grep -rn "checkIn=" apps/website/src apps/guest-communication-agent/src`.
  The Stripe `cancel_url`/`success_url` in `booking/[type]/actions.ts` carry no
  date params, so the notice can only ever be triggered by a GCA link or a
  hand-edited URL.

### 2. Classify the rejection in `resolveInitialCheckDates`

In `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`:

- Add a module-level type
  `type LinkDateRejection = "unreadable" | "past" | "unavailable";`
- Change `resolveInitialCheckDates`'s return type to
  `{ checkIn: Date | null; checkOut: Date | null; rejection: LinkDateRejection | null }`.
- Rewrite its body as an ordered classification, keeping the accept condition
  byte-for-byte equivalent to today's:
  - Compute the defaults object once
    (`defaultCheckIn ? fromCalendarDay(defaultCheckIn) : null`, same for
    check-out).
  - If neither `urlCheckIn` nor `urlCheckOut` is present, return the defaults
    with `rejection: null`. This is the untouched path for a direct visitor.
  - If only one of the two is present, or either parses to an Invalid Date
    (`Number.isNaN(parsed.getTime())`), or `parsedCheckOut <= parsedCheckIn`,
    return the defaults with `rejection: "unreadable"`. An inverted or
    half-supplied range is not a date the guest can be shown, so it belongs
    with "could not be read".
  - Else if `isPastDate(parsedCheckIn)` (import it from `@/lib/date-utils`;
    it is the same `startOfDay(new Date())` comparison `isValidDateRange`
    makes internally), return the defaults with `rejection: "past"`.
  - Else if `!isValidDateRange(parsedCheckIn, parsedCheckOut, blockedDates)`,
    return the defaults with `rejection: "unavailable"`.
  - Else return the parsed range with `rejection: null`.
- Update the function's doc comment to say it now reports _why_ a URL range was
  not applied, and why the order of the three checks is the order it is.

### 3. Seed the component's state from a single resolution

Still in `BookingClient.tsx`, replace the two lazy initialisers that each call
`resolveInitialCheckDates` (they compute the same thing twice today) with one:

```ts
const [initialSelection] = useState(() =>
  resolveInitialCheckDates(
    urlCheckIn,
    urlCheckOut,
    defaultCheckIn,
    defaultCheckOut,
    initialBlockedDates,
  ),
);
const [checkInDate, setCheckInDate] = useState<Date | null>(initialSelection.checkIn);
const [checkOutDate, setCheckOutDate] = useState<Date | null>(initialSelection.checkOut);
```

`useState`, not `useMemo`: the resolution must be computed exactly once for the
component's lifetime, so a later availability refresh through
`updateAvailability` can never retroactively change the notice for a link the
guest already opened. Keep the existing comments about why this is a lazy
initialiser rather than an Effect.

### 4. Render the notice

Still in `BookingClient.tsx`:

- Add a pure module-level helper
  `describeRejectedLinkDates(rejection: LinkDateRejection, urlCheckIn: string | null, urlCheckOut: string | null): string`.
  For `"past"` and `"unavailable"` it formats both parsed days with
  `format(fromCalendarDay(day), "d MMM yyyy")`, the same format and the same
  `→` separator the collapsed row uses, so the guest recognises them. For
  `"unreadable"` it names no dates, because by definition they could not be
  parsed.
- Copy, in the site's plain sentence-case voice, no em-dashes:
  - `past`: `The dates in your link (10 Jan 2020 → 12 Jan 2020) are in the past. Please pick new dates on the calendar below.`
  - `unavailable`: `The dates in your link (5 Sep 2026 → 7 Sep 2026) are no longer available. Please pick new dates on the calendar below.`
  - `unreadable`: `We could not read the dates in your link. Please pick your dates on the calendar below.`
- Render it as the **first** child of the `.booking-engine` wrapper, before
  `.booking-engine-collapsed`, so it is above the calendar in both the
  collapsed and the auto-expanded state:

```tsx
{
  initialSelection.rejection && (
    <div className="booking-engine-error" role="status">
      <p className="text-sm text-red-600">
        {describeRejectedLinkDates(initialSelection.rejection, urlCheckIn, urlCheckOut)}
      </p>
    </div>
  );
}
```

`role="status"` (implicit `aria-live="polite"`) rather than `role="alert"`:
this is a page-load condition the guest can act on at their own pace, and it
keeps the notice distinguishable in tests from the `role="alert"` submission
error already rendered inside `BookingEngineExpanded`. No new CSS rule:
`.booking-engine-error` already exists in `globals.css` and is the container
the page-level and widget-level booking errors already use.

- Do not touch the `if (error && !checkInDate)` early return, the collapsed
  markup, the `pricing` slot, or anything `BookingEngineExpanded` reads from
  the URL.

### 5. Open the calendar on the check-in month

In `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.tsx`, change
the `initialMonth` memo to prefer the selection:

```ts
const initialMonth = useMemo(
  () =>
    selectedCheckIn ? startOfMonth(selectedCheckIn) : findFirstMonthWithAvailability(blockedDates),
  [blockedDates, selectedCheckIn],
);
const [currentMonth, setCurrentMonth] = useState(initialMonth);
```

`startOfMonth` is already imported. The memo's value is consumed only as
`useState`'s initial argument, so recomputation on a later render is inert and
the guest's own paging with the ← / → buttons is never overridden. The calendar
renders `currentMonth` and `currentMonth + 1`, so a check-out in the following
month stays visible alongside the check-in.

### 6. Browser tests for the notice (`BookingClient.browser.test.tsx`)

Extend the existing file; its `next/navigation` mock and `mockSearchParams`
reset already do the setup work. Build the future fixtures relative to
`startOfDay(new Date())` with `addDays`/`format` so they never go stale:

- **past**: `mockSearchParams = new URLSearchParams({ checkIn: "2020-01-10", checkOut: "2020-01-12", phone: "+351920742845", source: "gca" })`.
  Assert the notice text matches `/in the past/`, that it names
  `10 Jan 2020` and `12 Jan 2020`, and that the collapsed row still shows the
  server defaults (`17 Jul 2025` / `19 Jul 2025` from `defaultProps`).
- **no longer available**: a future range (today + 30 to today + 33 days) with
  `blockedDates={[{ start: today+30, end: today+33 }]}`. Assert the notice
  matches `/no longer available/` and names both days.
- **could not be read**: `{ checkIn: "foo", checkOut: "bar" }`. Assert the
  notice matches `/could not be read/`. Add a second case in the same test or
  a sibling one for an inverted range (check-out before check-in) landing on
  the same message.
- **valid future range, no notice**: a free future range (today + 30 to
  today + 33 with `blockedDates: []`). Assert both formatted days appear in the
  collapsed row and `page.getByRole("status")` is not in the document.
- **negative, no URL dates**: render `defaultProps` with the default empty
  `mockSearchParams` and assert `page.getByRole("status")` is not in the
  document. This is the regression guard for "a URL with no dates behaves
  exactly as today".

Leave the existing tests alone, including the children-order assertion
(`["booking-engine-collapsed", "mock-pricing"]`) which must keep passing
unchanged, since it renders with no URL dates and therefore no notice.

### 7. Browser test for the calendar month (`BookingCalendar.browser.test.tsx`)

Add one test to the existing file, which already mocks
`findFirstMonthWithAvailability` to return July 2025 and `isPastDate` against a
15 July 2025 "today":

- Render with `selectedCheckIn={new Date(2025, 9, 5)}` and
  `selectedCheckOut={new Date(2025, 9, 8)}` (local constructors, not
  `new Date("2025-10-05")`, which is UTC midnight and can land in the previous
  month for a browser behind UTC, per `AGENTS.md`).
- Assert `October 2025` and `November 2025` are the rendered month titles and
  that `July 2025` is not.
- The existing `aria-pressed` tests pass a check-in in July 2025, the same
  month the mock returns, so they keep passing without edits.

### 8. Playwright spec (`e2e/booking-flow.integration.spec.ts`)

Append two tests to the existing `test.describe("Booking flow", ...)` block,
following the file's existing conventions (`baseURL` is configured; date
fixtures are computed from `startOfDay(new Date())` at the top of the file):

- **past link shows the notice and the engine is open**: navigate to
  `/booking/room1?checkIn=${format(addDays(today, -30), "yyyy-MM-dd")}&checkOut=${format(addDays(today, -28), "yyyy-MM-dd")}&phone=%2B351920742845&source=gca`.
  Assert the notice text matching `/are in the past/` is visible, and that the
  engine auto-expanded (`await expect(page.getByLabel("Confirm booking")).toBeVisible()`).
  This case needs no fixture seeding and is deterministic: a past range is
  rejected by `isValidDateRange` regardless of what local availability data
  says.
- **a future free range is preselected with no notice**: navigate to
  `/booking/room1?checkIn=${format(addDays(today, 300), "yyyy-MM-dd")}&checkOut=${format(addDays(today, 302), "yyyy-MM-dd")}&phone=%2B351920742845&source=gca`.
  Assert the collapsed check-in button has the text
  `format(addDays(today, 300), "d MMM yyyy")`, the check-out button
  `format(addDays(today, 302), "d MMM yyyy")`, and
  `await expect(page.getByRole("status")).toHaveCount(0)`. Add a comment
  explaining the choice of +300 days: this spec runs against real local data
  (the shared Supabase `bookings` table plus the configured iCal feeds, see the
  long comment at the top of the file), and OTA feeds do not publish blocks
  that far out, so the range is reliably free without seeding or resetting
  anything.

Do not seed or delete any rows for these two tests, and do not add an
`e2e/*.md` agent journey: both behaviours are a deterministic assertion on a
single page load, which is exactly what the Playwright layer is for.

### 9. Confirm the bug reproduces before the fix, then run the full validation

- Before applying steps 2 to 5 (or by stashing them into a temporary WIP
  commit), run `yarn workspace website test:browser --run` and confirm the new
  notice tests fail and the month test fails. That is the proof the tests bind
  to the fix rather than to unrelated behaviour.
- Then run every command in `Validation Commands` below, top to bottom, and
  confirm each exits clean.

## Test Coverage

Three layers, each proving a different half of the fix:

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx`
  (**primary**) - five cases: past, unavailable, unreadable, valid-future, and
  the no-URL-dates negative. This is the layer that catches the bug returning:
  the classification lives inside a client component seeded from
  `useSearchParams()`, so proving it means rendering the component with a
  mocked URL. Against the unfixed code, all four positive cases fail (no
  `role="status"` node exists at all) while the negative one passes, which is
  exactly the asymmetry the fix has to close. A `*.unit.test.ts` is not the
  right home: `resolveInitialCheckDates` is component-internal and the unit
  project only includes `src/**/*.unit.test.ts`, so reaching it would mean
  extracting a module purely to satisfy the test.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingCalendar.browser.test.tsx`
  - one case: with a check-in three months past the first available month, the
    calendar's left month title is the check-in's month. Fails today, where the
    mocked `findFirstMonthWithAvailability` return wins unconditionally.
- `apps/website/e2e/booking-flow.integration.spec.ts` - two cases proving the
  real GCA link shape end to end against a real server: a past link shows the
  notice with the engine expanded, and a free future link is preselected with
  no notice. This is the only layer that exercises the actual
  `?checkIn=&checkOut=&phone=&source=gca` URL through Next.js routing and the
  real server-computed `blockedDates`, rather than a mocked
  `useSearchParams` and a `blockedDates` fixture.

No test is added for `date-utils.ts`: it is unchanged, and `isValidDateRange` /
`isPastDate` already have their own coverage.

## Validation Commands

Execute every command from the repository root to validate the bug is fixed
with zero regressions.

- `yarn workspace website test:browser --run` - **before the fix**, the five new
  `BookingClient` notice cases and the new `BookingCalendar` month case fail;
  **after the fix**, the whole browser project passes. This is the
  reproduce-then-verify step, and it is also the command that runs the browser
  project (`yarn turbo run test` runs the unit project only).
- `yarn prettier --check .` - formatting matches the repo config, so the commit
  hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - types are sound,
  including the widened `resolveInitialCheckDates` return type
- `yarn knip` - no unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - unit tests pass, proving the
  surrounding booking logic is unregressed
- `yarn turbo run build --filter=./apps/website` - production build succeeds

The Playwright spec is run automatically by the test phase
(`yarn workspace website test:integration`) and needs no separate entry here.

## Notes

- **Scope boundary with #87.** This is the website half only. GCA continues to
  generate whatever it generates; #87 (merged as
  `fix/issue-87-adw-d7d0c40c-reject-past-dates-booking`) is what stops past and
  unavailable links being created in the first place. The two are complementary:
  #87 makes the notice rare, this issue makes it non-silent when it still
  happens, for example when a guest opens a week-old link whose check-in has
  since passed, or one whose dates were taken by an OTA booking in the meantime.
  Nothing in `apps/guest-communication-agent` changes, and the URL contract in
  `booking.ts:198` stays byte-identical.
- **No new dependency.** Everything needed (`format`, `startOfMonth`,
  `fromCalendarDay`, `isPastDate`, `isValidDateRange`) is already imported in
  the two files being changed or exported from `src/lib/date-utils.ts`.
- **The notice does not auto-dismiss.** It is seeded once and stays for the
  page's lifetime, including after the guest picks new dates. Hiding it on the
  first date selection would mean threading state through
  `BookingEngineExpanded`'s `handleDateSelect`, which is more machinery than
  the symptom justifies; the notice is short, sits above the engine, and reads
  as an explanation of the link rather than as a live validation error. Revisit
  only if it actually bothers anyone.
- **Half-supplied ranges are treated as unreadable.** No caller in this
  repository produces a URL with only one of the two params (the Stripe
  `cancel_url` carries none, the blog widget carries none), so the only way to
  hit it is a truncated or hand-edited link, where "we could not read the dates
  in your link" is the honest message.
- **An existing browser test hardcodes 2027 dates.** "user sees the exact days
  named by a GCA booking link" uses `checkIn: "2027-07-21"`, which will fall
  into the new `"past"` branch once that day passes and the test will start
  failing then. That staleness predates this change (`isValidDateRange` already
  rejects it today), so leave it alone here rather than widening the diff; it
  is worth a separate chore to make it relative.
- **Timezones are already handled and must stay that way.** Both the URL dates
  and the server defaults go through `fromCalendarDay` at local midnight, and
  `blockedDates` are normalised with `startOfDay`. Do not introduce
  `new Date("yyyy-MM-dd")` anywhere in this change, in the source or the tests,
  per `apps/website/AGENTS.md`.
