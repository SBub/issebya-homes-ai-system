# Bug: GCA sends booking links for dates in the past

## Metadata

issue_number: `87`
adw_id: `d7d0c40c`
issue_json: `{"number":87,"title":"fix(gca): reject past dates and re-verify availability before building a booking link","body":"Incident (2026-09-21, production). Guest wrote \"October 11-13 room 1\" on 2026-09-21. tool-check_availability returned {available:true, checkIn:2025-10-11, checkOut:2025-10-13, room:room1}; hitl-send_booking_link was approved by the owner; tool-send_booking_link built and sent https://issebya.com/booking/room1?checkIn=2025-10-11&checkOut=2025-10-13&... Root causes: the model resolved the year to 2025 without calling get_current_date; computeCheckAvailability (src/agent/tools/availability.ts:27) accepted a past range and reported it available because nothing is booked in the past; computeSendBookingLink (src/agent/tools/booking.ts:134) built the URL from the model's args verbatim, with no date validation and no availability re-check (the TODO at booking.ts:9-14 admits this). Proposed guards, all in the pure compute<ToolName> tier: (a) computeCheckAvailability rejects checkIn earlier than today and checkOut <= checkIn before the fetch, with today from the same source as get_current_date, returning {available:false, reason:\"past_date\"|\"invalid_range\",checkIn,checkOut,room}; (b) computeSendBookingLink applies the same validation through a shared validateStayRange(checkIn, checkOut, today) helper; (c) send_booking_link re-verifies availability, ideally before the HITL gate so the owner is never asked to approve an impossible link, refusing with {error, reason:\"not_available\"}. Tests: unit tests for the date guards (past date, today, inverted range, checkOut === checkIn, month and year boundaries, midnight edge in UTC), a booking.ts test where a not-available re-check blocks link creation, and an eval row. Acceptance criteria: past_date and invalid_range results from computeCheckAvailability; computeSendBookingLink refuses past or inverted ranges with no URL built; send_booking_link re-verifies availability against the same source as check_availability; TODO at booking.ts:9-14 removed; tests added and passing; replaying the 2026-09-21 input against a fixed clock yields a not-available result, not a link. Context: #84 (check_availability arg scorer and date-resolution-* golden rows), #86 (KB access fix), #85 (find_first_available, which will need the same guards)."}`

## Bug Description

On 2026-09-21 a guest wrote "October 11-13 room 1" to the WhatsApp agent. The
model resolved the year to 2025 instead of 2026 without ever calling
`get_current_date`. Every layer downstream accepted that silently:

- `check_availability` was called with `checkIn: "2025-10-11"`,
  `checkOut: "2025-10-13"` and answered `available: true`, because the site's
  availability feed contains no bookings in the past, so nothing conflicted.
- The owner was nudged on Telegram to approve a booking link for "11-10-2025 to
  13-10-2025" and approved it.
- `send_booking_link` built
  `https://issebya.com/booking/room1?checkIn=2025-10-11&checkOut=2025-10-13&...`
  from the model's arguments verbatim and sent it to the guest.

Expected behaviour: a stay range that starts before today, or whose check-out is
not after its check-in, is never reported as available and never becomes a
booking URL, whatever the model asks for. A booking link is only built for a
room that is genuinely free for those dates at the moment the link is built.

Actual behaviour: both tools trust the model's arguments completely. A past
range is "available" (nothing is booked in the past), and the URL builder is a
pure string template with no validation at all.

The system prompt was already patched (rule 3 now requires `get_current_date`
for a year-less date) and #84 added an args scorer plus `date-resolution-*`
golden rows, but both of those constrain the model, not the code. Nothing in
the code path stops a repeat.

## Problem Statement

`computeCheckAvailability` and `computeSendBookingLink` have no notion of
"today" and no notion of a valid stay range, and `send_booking_link` never
re-verifies availability before a link is built and sent. A single model
mistake about the year therefore turns into a guest-facing, owner-approved
booking link for dates that have already passed.

## Solution Statement

Add one shared, pure date guard and wire it into both tools, then close the
re-verification gap that the TODO at the top of `booking.ts` already describes:

1. A new `src/agent/tools/stay-range.ts` exports
   `validateStayRange(checkIn, checkOut, today)`, returning `null` when the
   range is usable or one of `"invalid_date" | "past_date" | "invalid_range"`.
   `today` defaults to `computeCurrentDate().date`, so the guard and the
   `get_current_date` tool read the same clock and the same timezone, and move
   together if a property timezone is ever introduced.
2. `computeCheckAvailability` runs the guard before the
   `GET /api/availability?room=` fetch and returns
   `{ available: false, reason, room, checkIn, checkOut, today }` instead of
   fetching. It can no longer answer `available: true` for a past or inverted
   range.
3. `computeSendBookingLink` runs the same guard and returns
   `{ error, reason }` instead of `{ url }` when it fails, so no URL is built
   on any call path, including the admin "resend a stuck link" route.
4. `requestSendBookingLinkApproval` (the HITL half of `send_booking_link`)
   re-verifies the exact room and dates by calling `computeCheckAvailability`
   before it asks the owner for anything. If the range is bad or the room is
   taken, it resolves as not approved with a structured refusal, so the owner
   is never nudged about an impossible link and the model gets a result it can
   act on. The TODO at `booking.ts:9-14` is deleted, since this is the
   defensive re-check it asks for.
5. The hand-written `checkAvailability` mirror inside `sandbox.ts`'s generated
   script gets the same guard, so the `run_code` path cannot report the past as
   available either.

The change stays entirely inside the pure `compute<ToolName>` tier plus one
step-wrapped call in the existing approval function. No tool gains a new span,
no dispatch loop changes, and `run-agent-turn.ts` is untouched: it already
returns `approvalDecision.notApprovedOutput` to the model whenever a gated tool
is not approved.

## Steps to Reproduce

1. Pin the clock to the incident date (2026-09-21) and call the availability
   tool with the year the model produced:
   `computeCheckAvailability({ room: "room1", checkIn: "2025-10-11", checkOut: "2025-10-13" })`.
2. Observe `{ available: true, room: "room1", checkIn: "2025-10-11", checkOut: "2025-10-13" }`,
   because the availability feed holds no bookings in the past.
3. Call `computeSendBookingLink` with the same arguments.
4. Observe a fully-formed `{ url }` containing `checkIn=2025-10-11`, with no
   validation and no availability re-check anywhere between step 2 and here.
5. The same sequence happens end to end in production: `tool-check_availability`
   then `hitl-send_booking_link` (owner approves) then `tool-send_booking_link`,
   as recorded on the 2026-09-21 Inngest run.

## Root Cause Analysis

Three independent gaps, each of which alone would have stopped the incident:

- **No clock in the availability check.** `computeCheckAvailability`
  (`apps/guest-communication-agent/src/agent/tools/availability.ts:27`) treats
  availability as purely "does this range overlap a booked range". It validates
  only that both dates parse. A past range overlaps nothing, so the answer is
  `available: true`. The tool never reads today's date, even though
  `computeCurrentDate` sits one file away and is already the app's single
  source of truth for "now".
- **No validation in the URL builder.** `computeSendBookingLink`
  (`.../src/agent/tools/booking.ts:134`) is a pure template literal over the
  model's arguments. Any pair of strings becomes a URL.
- **No re-verification before the human gate.** `send_booking_link` trusts that
  the model called `check_availability` first and got a usable answer. The TODO
  at `booking.ts:9-14` documents exactly this hole. Because the re-check is
  missing, the owner's approval is the only thing between a hallucinated date
  and the guest, and the owner is shown the same wrong dates the model
  produced, formatted as "11-10-2025 to 13-10-2025", which is easy to approve at
  a glance.

The trigger was the model resolving a year-less date to 2025, which the prompt
fix and #84 address. The root cause of the _guest-facing_ failure is that
neither tool has any invariant of its own.

## Relevant Files

Use these files to fix the bug:

- `apps/guest-communication-agent/AGENTS.md` - the two-tier rule this fix has to
  respect: business logic stays in a pure `compute<ToolName>`, the traced
  `run<ToolName>` only wraps it; a tool's own dispatch/HITL logic lives in its
  own file.
- `apps/guest-communication-agent/ENGINEERING.md` - §2 the tool table, §5 the
  `send_booking_link` HITL walkthrough, §6 `run_code`. Read before changing
  anything that can suspend a run; update §2/§5 at the end.
- `apps/guest-communication-agent/src/agent/tools/availability.ts` - guard (a)
  goes here, before the `GET /api/availability?room=` fetch.
- `apps/guest-communication-agent/src/agent/tools/current-date.ts` -
  `computeCurrentDate` is the single source of "today" the guard must use, and
  carries the existing UTC-only comment the new file should point at rather
  than restate.
- `apps/guest-communication-agent/src/agent/tools/booking.ts` - guard (b) in
  `computeSendBookingLink`, re-verification (c) in
  `requestSendBookingLinkApproval`, and the TODO at lines 9-14 to delete.
- `apps/guest-communication-agent/src/agent/tools/approval-gate.ts` - the
  `HitlDecision` shape a pre-gate refusal has to return (`approved: false`
  plus `notApprovedOutput`, `hitlSpanId`, `hitlAnchor`).
- `apps/guest-communication-agent/src/agent/run-agent-turn.ts` - read only, to
  confirm no change is needed: the `NEEDS_APPROVAL` branch already returns
  `approvalDecision.notApprovedOutput` to the model and tags the call.
- `apps/guest-communication-agent/src/agent/tool-execution.ts` -
  `detectToolSoftFailure`'s deliberately narrow rule explains why a multi-key
  `{ available: false, reason, ... }` result is normal data and not a span
  failure.
- `apps/guest-communication-agent/src/agent/tools/run-code.ts` - `sandboxApi`
  calls `computeCheckAvailability` directly, so it inherits the guard for free;
  its tool description text lists the shape the sandbox returns.
- `apps/guest-communication-agent/src/agent/tools/sandbox.ts` - the hand-written
  `checkAvailability` mirror inside `buildScript`, the second copy of the buggy
  logic.
- `apps/guest-communication-agent/src/app/api/admin/pending-decisions/[id]/actions/resolve/route.ts` -
  the other caller of `computeSendBookingLink`; must handle the new refusal
  branch.
- `apps/guest-communication-agent/tests/agent/tools/booking.test.ts` - existing
  coverage for the gate and the URL builder; its `bookingArgs` fixture uses
  2026-09-01, which is already in the past and will now be refused.
- `apps/guest-communication-agent/tests/agent/run-agent-turn.test.ts` - drives a
  full `send_booking_link` approval round with the same stale 2026-09-01 dates.
- `apps/guest-communication-agent/tests/api/admin/pending-decisions/[id]/actions/resolve/route.test.ts` -
  covers the admin resend path.
- `apps/guest-communication-agent/vitest.config.ts` - already sets
  `NEXT_PUBLIC_SITE_URL`, so a stubbed `fetch` is all the new tests need.

### New Files

- `apps/guest-communication-agent/src/agent/tools/stay-range.ts` - the shared
  `validateStayRange` helper and its `StayRangeProblem` union.
- `apps/guest-communication-agent/tests/agent/tools/stay-range.test.ts` - unit
  tests for the helper.
- `apps/guest-communication-agent/tests/agent/tools/availability.test.ts` -
  first test file for `availability.ts`; it has none today.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the shared stay-range guard

- Create `apps/guest-communication-agent/src/agent/tools/stay-range.ts`.
- Export `type StayRangeProblem = "invalid_date" | "past_date" | "invalid_range"`.
- Export
  `validateStayRange(checkIn: string, checkOut: string, today: string = computeCurrentDate().date): StayRangeProblem | null`.
- Order of checks, first match wins:
  - `"invalid_date"` when either string is not `^\d{4}-\d{2}-\d{2}$` or
    `new Date(value)` is `NaN` (JS rejects impossible ISO dates such as
    `2026-02-31`, so this also catches those).
  - `"past_date"` when `checkIn < today`.
  - `"invalid_range"` when `checkOut <= checkIn`.
  - otherwise `null`.
- Compare the ISO strings lexicographically rather than parsing to `Date`
  objects: for `YYYY-MM-DD` it is exact, and it keeps month and year rollovers
  free of any timezone arithmetic.
- `checkIn === today` is valid: same-day bookings must keep working.
- One short comment only, pointing at `computeCurrentDate` as the single source
  of today and its UTC caveat. Do not restate that caveat here (AGENTS.md:
  state a fact once, at its canonical definition).

### 2. Unit-test the guard

- Create `apps/guest-communication-agent/tests/agent/tools/stay-range.test.ts`,
  calling `validateStayRange` with an explicit `today` so no fake timers are
  needed.
- Cases: valid future range; `checkIn === today` (valid); `checkIn` one day
  before today (`past_date`); `checkOut === checkIn` (`invalid_range`);
  `checkOut` before `checkIn` (`invalid_range`); the incident pair
  (`2025-10-11`/`2025-10-13` with `today = "2026-09-21"` gives `past_date`);
  month boundary (`today = "2026-09-30"`, `checkIn = "2026-10-01"` is valid);
  year boundary (`today = "2026-12-31"`, `checkIn = "2027-01-01"` is valid,
  `checkIn = "2026-12-30"` is `past_date`); malformed inputs (`"20260901"`,
  `"2026-9-1"`, `"tomorrow"`, `"2026-02-31"`) all `invalid_date`.
- Add one case proving the default `today` tracks the real clock: `vi.useFakeTimers()`
  with `vi.setSystemTime(new Date("2026-09-21T00:15:00.000Z"))`, then
  `validateStayRange("2026-09-21", "2026-09-23")` is `null` and
  `validateStayRange("2026-09-20", "2026-09-22")` is `"past_date"`. This is the
  midnight-edge case from the issue, pinned to UTC, matching
  `current-date.test.ts`'s own midnight test.

### 3. Guard `computeCheckAvailability`

- In `availability.ts`, call `validateStayRange(checkIn, checkOut)` first and
  return early, before the fetch, when it reports a problem:
  `{ available: false, reason, room, checkIn, checkOut, today }` where `today`
  is `computeCurrentDate().date`.
- `today` is in the result on purpose: the model's single wrong fact was the
  date, and returning it lets the model re-resolve without a second tool round
  trip.
- This replaces the current `Number.isNaN` branch and its
  `{ available: false, error: "Invalid date format" }` return; a malformed date
  now comes back as `reason: "invalid_date"` with the same `available: false`.
- Update the comment above `computeCheckAvailability` to mention that it owns
  the date guard, keeping it to one line.
- Note for the reviewer: the result stays multi-key, so
  `tool-execution.ts`'s `detectToolSoftFailure` still treats it as normal data
  rather than a span failure, which is the documented intent for a refused
  availability answer.

### 4. Test `computeCheckAvailability`'s guard

- Create `apps/guest-communication-agent/tests/agent/tools/availability.test.ts`.
- Stub `fetch` with `vi.stubGlobal("fetch", fetchMock)` the way
  `tests/lib/twilio-send.test.ts` does, and pin the clock with
  `vi.setSystemTime(new Date("2026-09-21T10:00:00.000Z"))`.
- Tests:
  - The incident replay: `{ room: "room1", checkIn: "2025-10-11", checkOut: "2025-10-13" }`
    returns `{ available: false, reason: "past_date", ... }` and `fetchMock` was
    never called. This is the test that fails against today's code.
  - `checkOut === checkIn` returns `reason: "invalid_range"` with no fetch.
  - A malformed date returns `reason: "invalid_date"` with no fetch.
  - A future range with no conflicting booking still returns
    `{ available: true, room, checkIn, checkOut }`, proving the guard did not
    change the happy path.
  - A future range overlapping a booked range still returns `available: false`
    with no `reason` key, proving "booked" and "refused" stay distinguishable.

### 5. Guard `computeSendBookingLink`

- Change the return type to
  `{ url: string } | { error: string; reason: StayRangeProblem }`.
- Run `validateStayRange(checkIn, checkOut)` first; on a problem, return
  `{ error, reason }` with a short guest-agnostic message naming today's date
  (for example `Cannot build a booking link: check-in 2025-10-11 is in the past (today is 2026-09-21).`).
  No URL is constructed on that path.
- Leave the URL template, `BOOKING_LINK_URL_PATTERN` and the
  `runSendBookingLink` wrapper untouched; the wrapper returns whichever branch
  `computeSendBookingLink` produced.
- Update the admin resolve route
  (`src/app/api/admin/pending-decisions/[id]/actions/resolve/route.ts`) to
  narrow the result: on the error branch, return
  `NextResponse.json({ error: result.error }, { status: 400 })` alongside the
  existing missing-context 400; on the success branch, assign `result.url` to
  `messageText` as before.

### 6. Re-verify availability before the owner is asked

- In `booking.ts`, delete the TODO at lines 9-14.
- Add a small named function above `requestSendBookingLinkApproval`, for example
  `verifyBookingRequest(args)`, that calls `computeCheckAvailability` with the
  call's `room`/`checkIn`/`checkOut` and returns either `null` or the refusal
  object. It maps the availability result to
  `{ approved: false, error, reason }`, where `reason` is the availability
  result's own `reason` when it has one (`past_date`, `invalid_range`,
  `invalid_date`) and `"not_available"` when the room is simply booked. One
  call covers both the date guard and the re-check, so the two tools cannot
  disagree about the same range.
- In `requestSendBookingLinkApproval`, run it after the `hitl.<name>` gate span
  is created and flushed, and before `requestApprovalGate`:
  `const refusal = await step.run("verify-send_booking_link-availability", () => verifyBookingRequest(args))`.
  When `refusal` is non-null, patch the gate span with it through a
  `step.run("update-send_booking_link-refusal-trace-io", ...)` call to
  `updateSpanIO` (a distinct step id from the existing reject-path one, so the
  two branches never collide) and return
  `{ approved: false, notApprovedOutput: refusal, hitlSpanId, hitlAnchor }`.
- Placing it after the span, not before, keeps `HitlDecision`'s required
  `hitlSpanId`/`hitlAnchor` honest and makes the refusal visible in the trace
  as the gate's own output. No owner nudge is sent, because
  `requestApprovalGate` is never reached, which is the "never ask the owner to
  approve an impossible link" requirement.
- `run-agent-turn.ts` needs no change: its `NEEDS_APPROVAL` branch already
  returns `approvalDecision.notApprovedOutput` to the model and pushes the tool
  name onto `firedTags`.
- Keep the existing availability-endpoint failure behaviour: if
  `GET /api/availability?room=` is down, `computeCheckAvailability` throws and
  the Inngest step retries. That is the same failure mode the model's own
  `check_availability` call already has in the same turn, so this adds no new
  one.

### 7. Extend the booking tests

- In `tests/agent/tools/booking.test.ts`, pin the clock with
  `vi.setSystemTime(new Date("2026-09-21T10:00:00.000Z"))` and move the shared
  `bookingArgs` fixture to a range after it (its current 2026-09-01 dates are
  now in the past and would be refused, and any hardcoded "future" date rots
  otherwise). Stub `fetch` so the new re-check resolves; default it to an empty
  `bookings` array.
- Add tests:
  - `computeSendBookingLink` with the incident's 2025 dates returns
    `{ error, reason: "past_date" }` and no `url` key.
  - `computeSendBookingLink` with `checkOut === checkIn` returns
    `reason: "invalid_range"`.
  - `requestSendBookingLinkApproval` with a room the availability feed reports
    as booked resolves `{ approved: false }` with
    `notApprovedOutput.reason === "not_available"`, and neither
    `sendOwnerNudgeMock` nor `step.waitForEvent` was called.
  - `requestSendBookingLinkApproval` with the incident's past dates resolves
    `{ approved: false }` with `notApprovedOutput.reason === "past_date"`, again
    with no owner nudge.
  - The existing happy path still nudges the owner, suspends on
    `waitForEvent`, and produces a `{ url }` once approved.
- In `tests/agent/run-agent-turn.test.ts`, pin the same fake clock and stub
  `fetch` for the multi-tool round that approves `send_booking_link`, moving its
  inline 2026-09-01/2026-09-05 arguments to a range after the pinned date so the
  test keeps asserting the approved `{ url }` result.
- In the resolve route test, add a case where the stored row's `context` holds a
  past `checkIn` and the route answers 400 with the refusal message instead of
  sending a link.

### 8. Mirror the guard in the sandbox script

- `sandbox.ts`'s `buildScript` hand-writes a `checkAvailability` shim that
  duplicates the tool's logic (it cannot ship the real closure into the remote
  VM). Add the same two checks to that generated shim: compare `checkIn` against
  `new Date().toISOString().slice(0, 10)` and reject `checkOut <= checkIn`,
  returning the same `{ available: false, reason, room, checkIn, checkOut, today }`
  shape.
- Without this, `run_code` (the tool the `date-resolution-vague-*` rows expect
  the model to use for "asap") keeps a second copy of exactly the bug being
  fixed.
- Update the `run_code` tool description's `checkAvailability` result line in
  `run-code.ts` to mention the refusal shape, keeping it to one line.

### 9. Update the app documentation

- `ENGINEERING.md` §2 tool table: note that `check_availability` refuses past
  and inverted ranges rather than reporting them available.
- `ENGINEERING.md` §5: add the pre-gate re-verification to the
  `send_booking_link` walkthrough, stating that a refused range resolves the
  gate without nudging the owner.
- No `docs/conditional-docs.md` entry is needed: no new reference document is
  created, only two edits inside a document that is already indexed.

### 10. Run the validation commands

- Run every command in `Validation Commands`, in order, and fix anything that
  is not green.

## Test Coverage

Three regression tests, all at the cheapest layer that proves the behaviour.
This workspace's unit tests live in `apps/guest-communication-agent/tests/**`
as plain `*.test.ts` files run by `vitest run`; the `*.unit.test.ts` /
`*.browser.test.tsx` split is an `apps/website` convention and does not apply
here.

- `apps/guest-communication-agent/tests/agent/tools/availability.test.ts` (new)
  - the incident replay: with the clock pinned to 2026-09-21,
    `computeCheckAvailability({ room: "room1", checkIn: "2025-10-11", checkOut: "2025-10-13" })`
    must return `available: false` with `reason: "past_date"` and must not
    fetch. Against today's code it returns `available: true`, so this test fails
    before the fix and passes after it. This is the acceptance criterion
    "replaying the 2026-09-21 input against a fixed clock yields a not-available
    result".
- `apps/guest-communication-agent/tests/agent/tools/stay-range.test.ts` (new) -
  the boundary table (today, past, inverted, equal dates, month/year rollover,
  malformed input, UTC midnight). Catches an off-by-one that would either block
  same-day bookings or let yesterday through.
- `apps/guest-communication-agent/tests/agent/tools/booking.test.ts` (extended)
  - a not-available re-check blocks link creation, resolves the gate as not
    approved with the structured refusal, and sends no owner nudge; and
    `computeSendBookingLink` builds no URL for a past or inverted range.

No browser or Playwright coverage. `guest-communication-agent` is a webhook
service with no browser surface; only `apps/website` has one, and nothing in
this fix touches it.

No new golden eval row. The issue asks for "one eval row where the model passes
a past date and the expected outcome is not-available", but
`evals/executors.ts` runs a single `generateText` round with schema-only tools
and never executes any tool, so a dataset row can only assert which tool the
model asked for and with which arguments, never what the tool returned. The
model-side half of this incident is already covered by the `date-resolution-*`
rows added in #84 (`scripts/push-date-resolution-rows.ts`), in particular
`date-resolution-year-02`, whose `check_availability` arguments are deep-equal
scored against `2026-10-11`/`2026-10-13`. The code-side half is what the unit
tests above prove. Adding a row that cannot observe the guard would score the
prompt twice and the fix zero times.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `yarn turbo run test --filter=./apps/guest-communication-agent` - run this
  once after writing the new tests but before applying the fixes in steps 3, 5
  and 6: the new availability, stay-range and booking assertions must FAIL,
  proving they exercise the bug. Then run it again after the fixes: the whole
  suite must pass, including the pre-existing booking, run-agent-turn, sandbox
  and resolve-route tests.
- `yarn prettier --check .` - formatting matches the repo config, so the commit
  hook will not reject it
- `yarn turbo run lint --filter=./apps/guest-communication-agent` - lint passes
  for the workspace
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent` - types
  are sound, which is also what proves every `computeSendBookingLink` caller
  handles the new union return
- `yarn knip` - no unused files, exports or dependencies were introduced by the
  new `stay-range.ts`
- `yarn turbo run build --filter=./apps/guest-communication-agent` - production
  build succeeds

## Notes

- No new dependency. Everything needed is already in the workspace.
- Deviation from the issue's acceptance criteria: no eval row is added, for the
  reason set out in `Test Coverage`. Every other acceptance criterion is
  covered, including deleting the TODO at `booking.ts:9-14`.
- Two result shapes change, both model-facing only, neither persisted:
  `computeCheckAvailability`'s malformed-date return moves from
  `{ available: false, error: "Invalid date format" }` to
  `{ available: false, reason: "invalid_date", ... }`, and
  `computeSendBookingLink` gains a refusal branch next to `{ url }`. Nothing
  reads either shape from the database, and `BOOKING_LINK_URL_PATTERN` (which
  `hitl-compliance.scorer.ts` imports) is unchanged.
- The admin resend route gets the date guard but not the availability re-check:
  it re-sends a link for a decision the owner already approved, and its dates
  were verified when that decision was created. Worth revisiting only if a
  stuck decision can sit long enough for the room to be taken in between.
- #85's `find_first_available` should import `validateStayRange` rather than
  re-derive the same checks; step 1 puts it in a shared file precisely so that
  is a one-line import.
- If a property timezone (Europe/Lisbon) is ever introduced, it belongs in
  `computeCurrentDate` alone. `validateStayRange` defaults to it, so both tools
  move together automatically.
