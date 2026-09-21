# Past and inverted stay ranges are refused before a booking link exists

**ADW ID:** d7d0c40c
**Date:** 2026-09-21
**Specification:** `specs/issue-87-adw-d7d0c40c-sdlc_planner-reject-past-dates-booking.md`

## Overview

On 2026-09-21 a guest asked about "October 11-13 room 1", the model resolved the
year to 2025 without calling `get_current_date`, and every layer downstream
accepted it: `check_availability` answered `available: true` (nothing is ever
booked in the past, so nothing conflicted), the owner approved the Telegram
nudge, and `send_booking_link` built a live URL for dates that had already
passed.

The tools now carry their own invariants. A shared `validateStayRange` guard
runs inside `computeCheckAvailability` and `computeSendBookingLink`, and
`send_booking_link` independently re-verifies room and dates before the owner is
asked for anything. A model mistake about the year can no longer reach the guest
or even the owner.

## What Was Built

- `validateStayRange(checkIn, checkOut, today)`, one shared pure guard returning
  `"invalid_date" | "past_date" | "invalid_range"` or `null`, with `today`
  defaulting to `computeCurrentDate().date` so the guard and the
  `get_current_date` tool read the same clock.
- `check_availability` refuses an unusable range before the availability fetch,
  returning `{ available: false, reason, room, checkIn, checkOut, today }`.
  `today` rides along so the model can re-resolve the date without a second tool
  round trip.
- `send_booking_link` re-verifies availability **before** the human gate. A past,
  inverted or already-booked range resolves the gate as not approved with a
  structured refusal, and no Telegram nudge is sent at all.
- `computeSendBookingLink` gained a refusal branch, so no call path builds a URL
  from an unusable range, including the admin "resend a stuck link" route.
- The `run_code` sandbox's hand-written `checkAvailability` mirror got the same
  guard, closing the second copy of the same bug.
- The TODO at the top of `booking.ts`, which described exactly this missing
  re-check, is gone because the re-check now exists.

## Technical Implementation

### Files Modified

- `src/agent/tools/stay-range.ts` (new): `validateStayRange` and the
  `StayRangeProblem` union. Checks run first-match-wins: `invalid_date`, then
  `past_date` (`checkIn < today`), then `invalid_range` (`checkOut <= checkIn`).
  `isCalendarDate` round-trips the parsed date back to the input string, because
  a `NaN` check alone lets V8 roll `2026-02-31` over into `2026-03-03`.
- `src/agent/tools/availability.ts`: guard runs before the
  `GET /api/availability?room=` fetch. Return type is now an explicit
  `AvailabilityResult` union so `booking.ts` can narrow on `reason`. The old
  `{ available: false, error: "Invalid date format" }` return is replaced by
  `reason: "invalid_date"`.
- `src/agent/tools/booking.ts`: adds `verifyBookingRequest` (one
  `computeCheckAvailability` call covering both the date guard and the live
  re-check) and `describeBookingRefusal` (model-facing, guest-agnostic message
  naming the failing dates and today). `requestSendBookingLinkApproval` runs the
  verification after the `hitl.send_booking_link` gate span is created and
  flushed, before `requestApprovalGate`. `computeSendBookingLink` returns
  `{ url } | { error, reason }`.
- `src/agent/tools/sandbox.ts`: the generated `checkAvailability` shim mirrors
  the guard. `buildScript` is now exported so a test can evaluate the emitted
  script rather than only match its text.
- `src/agent/tools/run-code.ts`: the tool description documents the refusal
  shape the sandbox can return.
- `src/agent/tool-execution.ts`: the comment explaining why a multi-key result
  with an `error` key is normal data now cites the booking refusal rather than
  the removed availability shape.
- `src/app/api/admin/pending-decisions/[id]/actions/resolve/route.ts`: narrows
  the new union and answers 400 with the refusal message instead of sending a
  link.
- `ENGINEERING.md`: §2 tool table notes the refusal; §5's `send_booking_link`
  walkthrough gains the pre-gate re-verification as its first step.

### Key Changes

- **One clock, one guard.** Both tools call the same `validateStayRange`, which
  defaults to `computeCurrentDate()`. They cannot disagree about a range, and a
  future property timezone only has to land in `computeCurrentDate`.
- **Dates compared as strings.** `YYYY-MM-DD` compares lexicographically and
  exactly, so month and year rollovers need no timezone arithmetic.
  `checkIn === today` stays valid: same-day bookings keep working.
- **Refusal before the owner, not after.** Verification sits after the gate span
  (so `hitlSpanId`/`hitlAnchor` stay honest and the refusal is visible in the
  trace as the gate's own output) and before `requestApprovalGate`. The owner is
  never nudged about a link that could not be built. `run-agent-turn.ts` needed
  no change: its `NEEDS_APPROVAL` branch already hands `notApprovedOutput` back
  to the model.
- **Refusals are data, not failures.** The results stay multi-key, so
  `detectToolSoftFailure`'s deliberately narrow rule still treats them as normal
  tool output rather than marking the span failed.
- **Template-literal landmine in the sandbox mirror.** The shim is emitted inside
  an untagged template literal, where `\d` collapses to a bare `d`. The first
  cut of the guard shipped `/^d{4}-d{2}-d{2}$/` into the remote VM and refused
  every date. The pattern is now written as `/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/`,
  escape-proof by construction, and a comment in `sandbox.ts` flags the trap.

## How to Use

Nothing to configure. The behaviour shows up on three paths:

1. **Guest asks about a past range.** `check_availability` answers
   `{ available: false, reason: "past_date", today: "<today>" }` with no fetch,
   and the model has today's date in hand to re-ask or correct itself.
2. **Model asks for a booking link anyway.** `send_booking_link` re-checks first.
   A bad range or a taken room resolves the gate as not approved, the owner's
   Telegram stays quiet, and the model receives a message such as
   `Cannot build a booking link: check-in 2025-10-11 is in the past (today is 2026-09-21).`
3. **Admin resends a stuck link.** The resolve route returns 400 with the same
   refusal message instead of sending a link whose stay has since passed.

## Configuration

None. No new dependency, no new environment variable. `NEXT_PUBLIC_SITE_URL`
(already set) still points the availability fetch and the URL builder at the
site.

## Testing

```
yarn turbo run test --filter=./apps/guest-communication-agent
yarn turbo run lint --filter=./apps/guest-communication-agent
yarn turbo run typecheck --filter=./apps/guest-communication-agent
yarn prettier --check .
yarn knip
yarn turbo run build --filter=./apps/guest-communication-agent
```

Coverage added:

- `tests/agent/tools/stay-range.test.ts` (new): the boundary table, covering
  today, past, inverted, equal dates, month and year rollovers, malformed input
  including `2026-02-31`, and the UTC midnight edge under fake timers.
- `tests/agent/tools/availability.test.ts` (new): the incident replay with the
  clock pinned to 2026-09-21 returns `reason: "past_date"` and never calls
  `fetch`; the happy path and the genuinely-booked path are unchanged, and a
  booked range still returns `available: false` with **no** `reason` key so
  "booked" and "refused" stay distinguishable.
- `tests/agent/tools/booking.test.ts` (extended): `computeSendBookingLink`
  builds no URL for a past or inverted range; a not-available re-check resolves
  the gate as not approved with no owner nudge and no `waitForEvent`.
- `tests/agent/tools/sandbox.test.ts` (extended): evaluates the generated
  `checkAvailability` shim with `fetch` stubbed and the clock pinned, asserting
  it mirrors `computeCheckAvailability` rather than only that the text looks
  right.
- `tests/api/.../resolve/route.test.ts` (extended): a stored row with a past
  `checkIn` answers 400 instead of sending.
- `tests/agent/run-agent-turn.test.ts`: fixtures moved off the now-past
  2026-09-01 dates and onto a range after the pinned clock, with `fetch` stubbed
  for the new re-check.

## Notes

- No new golden eval row, a deliberate deviation from the issue's acceptance
  criteria. `evals/executors.ts` runs a single `generateText` round with
  schema-only tools and never executes one, so a row could only assert which
  tool the model asked for and with which arguments, never what the tool
  returned. The model-side half is already covered by the `date-resolution-*`
  rows from #84; the code-side half is what these unit tests prove.
- The admin resend route gets the date guard but not the availability re-check.
  It re-sends a link for a decision the owner already approved, whose dates were
  verified when the decision was created. Worth revisiting only if a stuck
  decision can sit long enough for the room to be taken in between.
- #85's `find_first_available` should import `validateStayRange` rather than
  re-derive the same checks. The guard lives in a shared file precisely so that
  is a one-line import.
- If the availability endpoint is down, `computeCheckAvailability` throws and the
  Inngest step retries. That is the same failure mode `check_availability`
  already has in the same turn, so the re-check adds no new one.
- The sandbox shim is a hand-written mirror, not the real closure, and it cannot
  be imported into the remote VM. Any future change to `validateStayRange` has to
  be copied into `buildScript` by hand; the behavioural sandbox test is what
  catches the drift.
