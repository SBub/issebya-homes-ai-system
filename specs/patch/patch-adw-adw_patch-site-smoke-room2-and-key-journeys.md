# Patch: site smoke covers room 2 and the site's key journeys

## Metadata

adw_id: `adw_patch`
review_change_request: `Extend apps/website/e2e/site-smoke.integration.spec.ts (PR #246). Today it only checks navigation, so it misses the site's key functionality. Keep every existing test and add: (1) Room 2 everywhere room 1 is checked: /booking/room2 renders, its header link state is right, and it is reachable from the site's navigation. (2) A "key journeys" group, one short happy path each, reusing helpers and mocks from the existing specs (booking-flow, lock-in-flow, blog-booking-flow, shop) instead of copying them: nightly booking in room1 reaches Stripe (mocked by E2E_MOCK_STRIPE); nightly booking in room2 reaches Stripe; a lock-in week in room1 and in room2 reaches Stripe; saving a shop item to the wishlist shows the saved state (Resend mocked by E2E_MOCK_RESEND, never a real email); opening a blog post and booking a room from its widget reaches Stripe. Deep edge cases stay in the existing specs; the smoke checks each journey once, end to end. (3) Booking dates must not collide with the other specs (workers: 1, distinct date ranges, see blog-booking-flow.integration.spec.ts); clean up any rows the journeys write, as the other specs do. Verification: the spec passes; breaking one journey (e.g. temporarily disabling the room2 booking button) makes exactly that test fail (revert after).`

## Issue Summary

**Original Spec:** `specs/issue-243-adw-d2d33822-sdlc_planner-site-smoke-playwright-spec.md`
**Issue:** `site-smoke.integration.spec.ts` only checks navigation and static pages. It never opens `/booking/room2` and never runs a booking, lock-in, wishlist or blog-widget journey, so a broken checkout path passes the smoke. The existing specs share no helper module: the Stripe route mock, guest-detail filling, the "confirm and wait for Stripe" step, the lock-in `weekLabel` and the shop `wish` steps are each written inline, so the smoke cannot reuse them without copying.
**Solution:** Extract those repeated steps into one non-spec support module under `e2e/support/`, switch the existing specs' inline copies to it (no behaviour change), then extend the smoke with room 2 checks and a `key journeys` describe whose six tests each run one happy path through those helpers. Every journey books with a fresh random email and phone and deletes its rows in `finally`; date ranges are picked so no journey touches a window another spec books or seeds.

## Files to Modify

Use these files to implement the patch:

- `apps/website/e2e/support/journeys.ts` (new) - shared helpers, not a spec (Playwright's default `testMatch` ignores it; knip already treats `e2e/**/*.ts` as entry and project, so no knip change).
- `apps/website/e2e/site-smoke.integration.spec.ts` - room 2 checks and the `key journeys` group; every existing test kept unchanged.
- `apps/website/e2e/booking-flow.integration.spec.ts` - full-flow test uses the shared helpers.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` - widget booking test uses the shared helpers.
- `apps/website/e2e/lock-in-flow.integration.spec.ts` - `weekLabel`, Stripe mock, guest details, confirm and cleanup use the shared helpers.
- `apps/website/e2e/shop.integration.spec.ts` - the unsubscribe test's local `wish()` uses the shared `saveToWishlist`.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `apps/website/e2e/support/journeys.ts`

Each helper is lifted verbatim from the spec named, so behaviour is identical. Short top comment: shared steps for the integration specs, imported rather than copied; not a spec file.

- `mockStripeCheckout(page: Page)`: the `page.route("https://checkout.stripe.com/**", ... "Mock Stripe Checkout" ...)` block from `booking-flow`, with its one-line rationale (server-side Stripe call is mocked in-process by `E2E_MOCK_STRIPE`; this fulfils the browser redirect to the mocked session URL).
- `uniqueGuest()`: returns `{ email: \`e2e-${randomUUID()}@example.com\`, localNumber: \`92${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}\` }`, with lock-in-flow's comment on why both must be random (`guest_contacts`resolves by email, then phone; a fixed number lands on the shared contact). Accept an optional email prefix so lock-in-flow keeps`e2e-lock-in-`.
- `fillGuestDetails(page, { email, localNumber })`: fills `/^name/i` "Guest Example", `/email/i`, `/whatsapp number/i` (the three lines every booking spec repeats).
- `confirmAndReachStripe(page)`: `await expect(page.getByLabel("Confirm booking")).toBeEnabled()` then `Promise.all([page.waitForURL("https://checkout.stripe.com/**"), page.getByLabel("Confirm booking").click()])`.
- `selectCalendarRange(page, checkIn: Date, checkOut: Date)`: clicks `button:not([disabled])[aria-label="${format(d, "MMMM d, yyyy")}"]` for both days (the selector booking-flow and blog-booking-flow use).
- `deleteGuestBookings(email)`: `createAdminClient()`; select `guest_contacts.id` by email with `maybeSingle()`; if found, delete `bookings` by `guest_contact_id`, then the contact. Returns the contact id (or `null`) so lock-in-flow can still assert on its rows before cleanup. If submitBooking also expires the room's availability tag (it calls `revalidateTag(\`availability-${roomType}\`)`), no tag work is needed here since pending rows never block the calendar (`checkAvailability`and`getOwnBookings`count`confirmed` only).
- `lockInWeekLabel(week)`: lock-in-flow's `weekLabel` (`d MMM – d MMM` via `fromCalendarDay`).
- `pickFreeLockInWeek(page, weeks)`: lock-in-flow's loop over `button.lock-in-week` filtered by label, clicking the first present one and asserting `aria-pressed="true"`; returns the week or throws `No free lock-in week in local data`.
- `saveToWishlist(page, slug, email)`: shop's `wish()` body (goto `/shop/${slug}`, open the `WISHLIST_SAVE_LABEL` trigger, fill Email, check `WISHLIST_OPT_IN_COPY`, submit, expect status `WISHLIST_SUCCESS_COPY`), then also `await expect(page.getByRole("button", { name: WISHLIST_SAVED_LABEL, exact: true })).toHaveAttribute("aria-pressed", "true")`.
- Import `@/lib/...` the same way the specs do; export only what is used, so knip stays clean.

### Step 2: Point the existing specs at the helpers (no behaviour change)

- `booking-flow`: full-flow test uses `mockStripeCheckout`, `selectCalendarRange(page, checkInDate, checkOutDate)`, `fillGuestDetails` with the existing fixed `guest@example.com` / `920742845` (keep the values; this patch does not change that test's data), `confirmAndReachStripe`. Keep its long comment on the mocking story.
- `blog-booking-flow`: "booking completes from inside a post" uses the same four helpers with its existing values; drop `checkInLabel`/`checkOutLabel` only if no other test in the file still uses them (the room-switch test does, so keep them or switch it to `selectCalendarRange` too).
- `lock-in-flow`: replace local `weekLabel` with `lockInWeekLabel`, the Stripe route with `mockStripeCheckout`, the pick loop with `pickFreeLockInWeek`, the email/number generation with `uniqueGuest("e2e-lock-in-")`, the three fills with `fillGuestDetails`, the `Promise.all` with `confirmAndReachStripe`. Keep its DB assertions on the pending row; its `finally` may stay as is or call `deleteGuestBookings(email)`.
- `shop`: the unsubscribe test's local `wish` becomes `() => saveToWishlist(page, firstProduct.slug, email)`. Leave the "wishing the same product twice" test as written (it asserts intermediate states the helper skips).

### Step 3: Room 2 checks in `site-smoke.integration.spec.ts`

- Import `ROOM_CONTENT` from `@/lib/shared/room-content` and `BookingType` if useful.
- Turn the existing `"Booking is the active header link on /booking/room1"` into a loop over `["/booking/room1", "/booking/room2"]` with the same body and a title built from the path (room1 title text stays identical).
- New test `"/booking/room2 renders the room and its booking engine"`: goto `/booking/room2`; expect pathname `/booking/room2` (no redirect to room1); `page.getByText(ROOM_CONTENT.room2.description[0])` visible; `Select check-in date`, `Select check-out date`, `Book selected dates` visible.
- New test `"the Room 2 tab reaches /booking/room2 and Booking stays active"`: goto `/booking/room1` at the default 1280px viewport (desktop tabs; the mobile ones are `md:hidden`, so `getByRole` resolves only the visible one); click `page.getByRole("link", { name: "Room 2", exact: true })`; expect pathname `/booking/room2`, header `Booking` `toHaveClass(ACTIVE)`, the room2 description visible. Then click `Room 1` and expect `/booking/room1` (round trip).

### Step 4: `key journeys` describe in `site-smoke.integration.spec.ts`

Update the top comment: the static-page tests touch no database; the `key journeys` group writes rows under a fresh random email per test and deletes them in `finally`, with Stripe (`E2E_MOCK_STRIPE`) and Resend (`E2E_MOCK_RESEND`) mocked in-process.

Date windows, chosen clear of every other spec (record them in a comment next to the constants, citing the `workers: 1` note in `blog-booking-flow`): `booking-flow` books/seeds room1 +10..+13 and prefills room1 +300..+302; `blog-booking-flow` books room1 +10..+13 and seeds a confirmed room2 +40..+43; `lock-in-flow` seeds room1 inside the first lock-in week and books the first free room1 week from the start of the list.

- `NIGHTLY = { room1: [+320, +322], room2: [+324, +326] }` days from `startOfDay(new Date())`. Far enough out that OTA feeds publish no blocks (the same reasoning as booking-flow's +300 test), and reached through the `?checkIn=&checkOut=` prefill (`BookingClient` honours it without `phone`), so no month navigation is needed.
- Blog widget: room 2 tab, +6..+8 via `selectCalendarRange` (inside the month the calendar opens on, like the blog spec's +10; no spec books or seeds room2 there).
- Lock-in: pick from the end of the list, `pickFreeLockInWeek(page, [...weeks].reverse())`, so it never takes the first free week lock-in-flow books.

Tests, each wrapped as `const guest = uniqueGuest("e2e-smoke-"); try { ... } finally { await deleteGuestBookings(guest.email); }`:

1. `nightly booking in room1 reaches Stripe`: `mockStripeCheckout`; goto `/booking/room1?checkIn=…&checkOut=…`; click `Book selected dates`; expect `Confirm booking` visible; `fillGuestDetails`; `confirmAndReachStripe`.
2. `nightly booking in room2 reaches Stripe`: same with `/booking/room2` and the room2 window. Shape tests 1 and 2 as one `for (const room of ["room1", "room2"] as const)` loop so they stay identical.
3. `lock-in week in room1 reaches Stripe` and 4. `... room2 ...`: one loop; `mockStripeCheckout`; goto `/lock-in/${room}`; expect `.lock-in-week` count 12; `pickFreeLockInWeek(page, [...getLockInWeeks(new Date())].reverse())`; expect `Total: ${LOCK_IN_PRICING.weekPrice}€`; `fillGuestDetails`; `confirmAndReachStripe`.
4. `saving a shop item to the wishlist shows the saved state`: email `e2e-smoke-wishlist-${randomUUID()}@example.com`; `saveToWishlist(page, sortProducts(allProducts, "newest")[0].slug, email)` (asserts success copy and `aria-pressed="true"` on `WISHLIST_SAVED_LABEL`); `finally` deletes `shop_wishlist_contacts` by email (items cascade), exactly as shop's `afterEach`.
5. `booking a room from a blog post's widget reaches Stripe`: `mockStripeCheckout`; goto `/blog`; click the `A house for rest between the Sintra forest and the Atlantic` card link; expect URL `/blog/welcome-to-issebya-homes`; `article` contains `getByTestId("booking-widget")`; click `getByRole("tab", { name: "room 2" })`; `Book selected dates`; `selectCalendarRange(+6, +8)`; `fillGuestDetails`; `confirmAndReachStripe`.

### Step 5: Run and prove each journey is independent

- Run the smoke spec, then the full suite (validation below). Fix any failure in the helpers or the smoke, never by weakening an assertion.
- Mutation check, reverted afterwards: temporarily make `Confirm booking` disabled for room2 only (e.g. `disabled={roomType === "room2" || …}` in `BookingEngineExpanded.tsx`), rerun only the `key journeys` group, confirm exactly `nightly booking in room2 reaches Stripe` fails (the blog widget test uses room 2 too, so if it also fails, use a mutation on the `/booking/[type]` route only, e.g. the lock-in or nightly path, and record which one isolates a single test). Then `git checkout -- apps/website/src` and confirm `git status` shows no `src/` change.
- Confirm afterwards that no `e2e-smoke-` rows remain: `guest_contacts` and `shop_wishlist_contacts` with an `e2e-smoke-` email return zero rows (query through a one-off `createAdminClient()` read in the scratchpad, never committed).

## Validation

Execute every command to validate the patch is complete with zero regressions. Source `.ports.env` first and use its `PORT`; the `prepare_app` server must already be running on it with the overrides from `.adw/project.md`. Never set `CI=1`.

1. `yarn turbo run typecheck --filter=./apps/website && yarn turbo run lint --filter=./apps/website`
2. `yarn prettier --check . && yarn knip`
3. `yarn turbo run test --filter=./apps/website`
4. `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/site-smoke.integration.spec.ts` (passes), then the mutation check from Step 5 (exactly one journey fails), reverted.
5. `PORT=$PORT yarn workspace website test:integration --project=chromium` (whole suite green: the refactored specs and the smoke together, serial, prove no date collision), then `yarn turbo run build --filter=./apps/website`.

## Patch Scope

**Lines of code to change:** ~250 (≈110 new support module, ≈110 added to the smoke, ≈-40 net across the four refactored specs)
**Risk level:** medium (test-only, no `src/` change, but four existing specs are refactored onto shared helpers and the journeys write to the shared local Supabase)
**Testing required:** smoke spec green; full chromium integration suite green to prove the refactor and the date windows; one temporary mutation proving a single journey fails in isolation; zero leftover `e2e-smoke-` rows.
