# Patch: Tourist tax cases by stay type, in both rooms

## Metadata

adw_id: `adw_patch`
review_change_request: `Fix the tourist tax cases in apps/website/e2e/booking-confirmation.integration.spec.ts (PR #245). The rule is by stay type, not by room: a nightly stay always has tourist tax, a lock-in week never does, in either room. The app already works this way (actions.ts drops the tax line only when product === "lock-in"). The spec today pairs room1 with nightly and room2 with lock-in, so it cannot tell the two apart. Change: cover all four combinations (nightly room1 and nightly room2 show the tourist tax row; lock-in room1 and lock-in room2 show no tourist tax row); name the tests by the rule, e.g. "a nightly stay shows the tourist tax row (room1)", "a lock-in week shows no tourist tax row (room2)", no test name may suggest tax depends on the room; keep the other checks (details, email, mobile layout, not found without a session). Verification: the spec passes; temporarily making the confirmation page show the tax row for a lock-in booking makes the lock-in tests fail (revert after).`

## Issue Summary

**Original Spec:** `specs/issue-242-adw-8a7549d6-sdlc_planner-booking-confirmation-page-e2e.md`
**Issue:** The spec has one nightly fixture (room1) and one lock-in fixture (room2), and the test names read as if tourist tax depends on the room ("a nightly room1 booking shows ... tourist tax", "a room2 lock-in week shows ... no tourist tax row"). With room and stay type always paired, the suite cannot tell "tax by stay type" from "tax by room".
**Solution:** Parametrise the two tax tests over both rooms: build the nightly and lock-in fixtures per room, and loop `for (const roomType of ["room1", "room2"])` to generate four tests named by the rule with the room only as a parenthetical. The `bookings` row has no product column; the page (`src/app/(main)/booking/confirmation/ui/PriceBreakdown.tsx`) shows the "Tourist tax" row when `touristTax !== 0`, and a lock-in row is what `calculateLockInPrice()` writes (7 nights, `tourist_tax: 0`, total = base price). So a "lock-in week" fixture is a 7-night, 1-guest, `tourist_tax: 0` row and a "nightly stay" fixture is a 3-night, 2-guest row with `tourist_tax: 12`, in either room. Mobile layout and not-found tests stay as they are.

## Files to Modify

- `apps/website/e2e/booking-confirmation.integration.spec.ts`

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Replace the two fixed fixtures with per-room fixture builders

- Replace `const nightly: BookingFixture` and `const lockInWeek: BookingFixture` with two functions taking `roomType: "room1" | "room2"`:
  - `nightlyStay(roomType)`: same values as today's `nightly` (3 nights, 2 guests, base 300, tax 12, total 312).
  - `lockInWeek(roomType)`: same values as today's `lockInWeek` (7 nights, 1 guest, base 700, tax 0, total 700).
- Give each of the four (stay, room) pairs its own date window, all at day +120 or later so nothing overlaps other specs or each other: nightly room1 +120..+123, nightly room2 +124..+127, lock-in room1 +130..+137, lock-in room2 +140..+147. Pick the offset inside the builder (e.g. a small `{ room1: 120, room2: 124 }` / `{ room1: 130, room2: 140 }` map) and update the window comment above the fixtures to list these ranges.
- Keep a `const nightly = nightlyStay("room1")` (or call `nightlyStay("room1")` directly) for the mobile test, which stays room1 and unchanged in its assertions.

### Step 2: Turn the two tax tests into a loop over both rooms, named by the rule

- Inside `test.describe("Booking confirmation page", ...)`, add `for (const roomType of ["room1", "room2"] as const) { ... }` with a room label `const roomName = roomType === "room1" ? "Room 1" : "Room 2"`.
- Test 1 name: `` `a nightly stay shows the tourist tax row (${roomType})` ``. Body = today's nightly test with `nightlyStay(roomType)`: heading, "Thank you for your reservation", Room = `roomName`, Check-in/Check-out via `formatDay`, Nights "3", Guests "2 Guests", Room price €300, Tourist tax €12, Total €312, email text contains the seeded email, `getByRole("img", { name: roomName })` visible, `return-to-post` count 0.
- Test 2 name: `` `a lock-in week shows no tourist tax row (${roomType})` ``. Body = today's lock-in test with `lockInWeek(roomType)`: heading, Room = `roomName`, Check-in/Check-out, Nights "7", Guests exact "1 Guest", Room price €700, Total €700, then `page.getByText("Tourist tax")` count 0 (checked after the heading is visible; keep that comment).
- Delete the two old room-paired tests. No test name may mention a room outside the trailing `(${roomType})`.

### Step 3: Leave the rest untouched

- Mobile viewport test and the "without a session" not-found tests keep their current assertions. `seedConfirmedBooking`, `fieldValue`, `priceRow`, `confirmationUrl` are unchanged.

## Validation

Execute every command to validate the patch is complete with zero regressions. Source `.ports.env` first (`PORT` from it, 3000 only if absent); the `prepare_app` server must already be up on that port.

1. `yarn turbo run typecheck --filter=./apps/website`
2. `yarn turbo run lint --filter=./apps/website`
3. `yarn prettier --check .`
4. `yarn knip`
5. `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/booking-confirmation.integration.spec.ts`: 7 tests pass (4 tax tests, 1 mobile, 2 not-found), and the listed names are the four rule-named tests with `(room1)` / `(room2)`. Then the mutation check: temporarily change `touristTax !== 0 &&` in `apps/website/src/app/(main)/booking/confirmation/ui/PriceBreakdown.tsx` to `true &&`, rerun the same command, confirm both `a lock-in week shows no tourist tax row (room1|room2)` tests fail and the nightly tests still pass, then revert the file and confirm `git diff --stat` shows only the spec file changed.

## Patch Scope

**Lines of code to change:** ~60 (fixture builders + one loop replacing two tests)
**Risk level:** low
**Testing required:** Playwright integration spec for the confirmation page on chromium, plus the temporary PriceBreakdown mutation to prove the lock-in tests catch a tax row; typecheck, lint, prettier, knip.
