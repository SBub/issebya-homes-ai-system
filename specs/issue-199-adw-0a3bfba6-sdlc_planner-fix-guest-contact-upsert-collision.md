# Bug: Checkout fails when the phone and the email belong to two different guest_contacts rows

## Metadata

issue_number: `199`
adw_id: `0a3bfba6`
issue_json: `{"number":199,"title":"website: checkout fails with 'Failed to create checkout session' when the phone and the email belong to two different guest_contacts rows"}`

## Bug Description

Submitting the booking form on `/booking/[type]` with a WhatsApp number that already belongs to one `guest_contacts` row (row A) and an email that already belongs to a _different_ row (row B) returns the generic error "Failed to create checkout session". No Stripe session is created and the guest cannot pay.

Locally nothing is printed: the Server Action's `catch (contactError)` only calls Sentry's `captureException`, and Sentry is disabled outside production, so neither the dev terminal nor the network tab shows why. With a temporary log the underlying error is Postgres `23505`, `duplicate key value violates unique constraint "guest_contacts_email_key"`.

Expected: a returning guest can always complete checkout. The booking links to the email-matched contact row, the rows are reconciled without a collision, the owner gets a structured warning to merge by hand later, and any real failure is visible in the dev terminal.

Actual: the upsert throws a raw unique violation and checkout is blocked.

The same shape exists in production (a returning guest books with a new email but the same WhatsApp number, or the other way round), and it also affects the two other callers of `upsertGuestContact`: the Stripe webhook (`api/webhook/stripe/route.ts`, where a throw becomes a 500 and Stripe retries forever) and `api/bookings/direct/route.ts`.

## Problem Statement

`upsertGuestContact` in `apps/website/src/lib/shared/guest-contacts.ts` resolves the contact with a single `.or("phone.eq.<phone>,email.eq.<email>").limit(1).maybeSingle()` lookup, takes whichever row comes first, and then updates that row with **all** fields, including both unique keys `phone` and `email`. When the two keys are owned by two different rows, the update writes a value that another row already owns and Postgres rejects it. Only the insert branch handles `23505`; the update branch throws, and the action maps it to the generic message.

## Solution Statement

Make the contact resolution deterministic and collision-safe, entirely inside `guest-contacts.ts`, keeping the exported signature and return type unchanged:

1. Look the contact up by `email` first, then by `phone`, as two separate exact-match queries (`findByEmail`, `findByPhone`).
2. Branch on the result:
   - **Same row** (both hits have the same id) → full update of that row (today's behaviour).
   - **Two rows** (email hit and phone hit differ) → update the **email row** with the non-unique fields only (`guest_name`, `enabled`, `last_room`, stay dates, funnel fields); drop `phone` from the update because another row owns it, and leave the email row's existing `phone` untouched. Emit one `console.warn` with both row ids and no PII, and one Sentry `addBreadcrumb` with the same ids, so the owner can merge in Studio. Never delete or edit the phone row (it may own WhatsApp history in GCA, keyed by phone).
   - **Email row only** → full update (the phone is free, so it is written onto the email row).
   - **Phone row only** → full update (the email is free, so it is written onto the phone row).
   - **No row** → insert (today's behaviour).
3. On a `23505` from the update **or** the insert, re-run the resolution once (fresh `findByEmail` + `findByPhone`, which is the lookup by the conflicting key) and write again with unique fields stripped where another row owns them. Throw only if that single retry also fails. This replaces today's insert-only retry with one shared path, so a race or a stale lookup can never surface a raw unique violation.
4. In `actions.ts`, add a dev-only `console.error("[booking] …", …)` next to both `captureException` calls (the `contactError` catch and the outer catch), gated on `process.env.NODE_ENV !== "production"`, logging only the error `code` and `message` (the message carries the constraint name; the Postgres `details` field carries the email, so it is not logged).

No migration, no change to unique constraints, no change to GCA's own writes.

## Steps to Reproduce

Against the shared local Supabase (do not reset it), with the website dev server running on this worktree's `PORT`:

1. In Studio (http://127.0.0.1:54323) or with the admin client, make sure two `guest_contacts` rows exist: row A with `phone = '+351<nine digits>'` and an unrelated email (or null), row B with `email = '<some email>'` and a different phone (or null).
2. Open `/booking/room1`, click "Book selected dates", pick a free range.
3. Fill name, email = row B's email, WhatsApp number = row A's nine local digits (default country Portugal, so the stored phone is `+351<digits>`).
4. Click "Confirm booking".
5. Observe "Failed to create checkout session" in the form and nothing in the dev terminal. (With a temporary `console.error` in the catch, the error is `23505` on `guest_contacts_email_key`.)

The unit test and Playwright spec added below reproduce the same thing deterministically.

## Root Cause Analysis

- `guest_contacts` has two independent nullable-but-unique keys: `guest_contacts_phone_key` (`20260721090350_add_id_and_guest_name_normalized_to_guest_contacts.sql`) and `guest_contacts_email_key` (`20260821160000_link_bookings_to_guest_contacts.sql`). A guest can legitimately be split across two rows: GCA creates phone-keyed rows from WhatsApp, and bookings/backfill create email-keyed rows.
- The earlier fix for Sentry JAVASCRIPT-NEXTJS-1E moved from `upsert(onConflict: "phone")` to "look up by phone OR email, update if found". Its inline comment in `updateExisting` states the assumption that the found row _is_ this guest's whole identity, so writing both keys is safe. That assumption is false once the phone and the email each match a _different_ row: `.or(...).limit(1)` returns an arbitrary one of the two (no `order`), and writing the other key onto it violates the other row's unique constraint.
- The `23505` recovery exists only on the insert branch; the update branch rethrows, and `submitBooking` converts every throw into the generic "Failed to create checkout session".
- Invisibility locally is a separate, contributing cause: `captureException` is a no-op without Sentry, and the catch blocks log nothing else.

## Relevant Files

Use these files to fix the bug:

- `README.md` - repository overview, read first.
- `AGENTS.md` - repo-wide conventions (yarn only, conventional commits, never reset the shared Supabase, filter turbo by path).
- `apps/website/AGENTS.md` - website conventions and which test layers gate (unit + browser in CI/pre-push; Playwright `e2e/` runs in the ADW test phase only).
- `apps/website/ENGINEERING.md` - booking persistence background (the pending-booking write that needs `guest_contact_id`).
- `apps/website/app_docs/database/database-interaction-rules.md` - admin client for direct table access; applies to the `guest_contacts` writes. No migration is needed.
- `apps/website/app_docs/testing/unit_test_spec_format.md` - format for the unit tests.
- `apps/website/app_docs/testing/e2e_example.md` - conventions for the Playwright spec.
- `apps/website/src/lib/shared/guest-contacts.ts` - **the bug**. `upsertGuestContact`, `buildFields`, `updateExisting`: rewrite the lookup and the update/insert branching here.
- `apps/website/src/lib/shared/__tests__/guest-contacts.unit.test.ts` - existing unit tests with a chainable admin-client stub. Its lookup stubs assume the single `.or(...)` query and must be updated to the two lookups; new cases are added here.
- `apps/website/src/app/(main)/booking/[type]/actions.ts` - `submitBooking`: the `catch (contactError)` block (~line 358) and the outer `catch (error)` (~line 524) get the dev-only `console.error`.
- `apps/website/src/app/api/webhook/stripe/route.ts` - caller of `upsertGuestContact` (lines ~113 and ~176); no change, but it benefits from the fix and must keep compiling against the unchanged signature.
- `apps/website/src/app/api/bookings/direct/route.ts` - caller of `upsertGuestContact` (~line 176); no change.
- `apps/website/e2e/booking-flow.integration.spec.ts` - model for the new Playwright spec (admin-client fixtures, mocked Stripe navigation via `page.route`, `E2E_MOCK_STRIPE` in-process mock).
- `supabase/migrations/20260721090350_add_id_and_guest_name_normalized_to_guest_contacts.sql`, `supabase/migrations/20260821160000_link_bookings_to_guest_contacts.sql` - the two unique constraints; read-only context.

### New Files

- `apps/website/e2e/booking-split-guest-contact.integration.spec.ts` - Playwright regression: seeds a phone-owning row and an email-owning row, submits checkout with both, expects navigation to (mocked) Stripe Checkout.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add deterministic lookups in `guest-contacts.ts`

- Add two private helpers, each taking the admin client:
  - `findByEmail(supabase, email)` → `.from("guest_contacts").select("id, phone, email").eq("email", email).maybeSingle()`; throw the Postgrest error if any; return the row or `null`.
  - `findByPhone(supabase, phone)` → same with `.eq("phone", phone)`.
- Call them sequentially (email first, then phone) so the order of `from()` calls is deterministic for the unit-test stub.
- Remove the `.or(...)` lookups (both the initial one and the insert-retry one). This also removes string-interpolating user input into a PostgREST `or` filter.

### 2. Add a resolution step that picks the target row and safe fields

- Add a private `resolveTarget(supabase, params, fields)` that runs the two lookups and returns either `{ kind: "insert", fields }` or `{ kind: "update", id, fields }`:
  - email row and phone row both present with the same id → update that id with full `fields`.
  - both present, different ids → update the **email row's** id with `fields` minus `phone` (build via destructuring, `const { phone: _phone, ...rest } = fields`, or an equivalent that passes lint). Log `console.warn("[guest-contacts] phone and email belong to different rows; linked to email row, phone left on its own row", { emailRowId, phoneRowId })` and `addBreadcrumb({ category: "guest_contacts", level: "warning", message: "split guest contact", data: { emailRowId, phoneRowId } })` from `@sentry/nextjs`. No phone, email or name in either.
  - only email row → update it with full `fields`.
  - only phone row → update it with full `fields`.
  - neither → insert with full `fields`.
- Keep `buildFields` unchanged. Type the stripped variant so `updateExisting` accepts both (e.g. widen its `fields` parameter to `Partial<ReturnType<typeof buildFields>>` or an `Omit<..., "phone">` union). Do not export anything new (knip).

### 3. Route both writes through one `23505` recovery

- Add a private `write(supabase, target)` that performs the update (`.update(fields).eq("id", id).select("id").single()`) or the insert (`.insert(fields).select("id").single()`) and returns `{ id }` or `{ error }` without throwing.
- Rewrite `upsertGuestContact`:
  1. `target = await resolveTarget(...)`; `result = await write(...)`.
  2. If `result.error?.code === UNIQUE_VIOLATION`, re-run `resolveTarget` once (this re-looks up by both keys, i.e. by the conflicting one, and applies the two-row stripping if the state now has two rows) and `write` again.
  3. Throw the error if the second attempt still fails, or if the first error was not `23505`. Throw `new Error("guest_contacts write returned no row")` when there is no error and no data, as today.
- Keep the exported signature `upsertGuestContact(params: UpsertGuestContactParams): Promise<string>`.
- Update the JSDoc on `upsertGuestContact` and remove the now-false comment in `updateExisting` ("that scenario doesn't arise here"): explain the email-first match order, why the email row is the booking's contact (`bookings.guest_contact_id`), why the phone row is never touched (GCA WhatsApp history keyed by phone), and the single `23505` retry covering both the race and a stale lookup. Keep the density of the existing comments.

### 4. Make local failures visible in `actions.ts`

- In `submitBooking`, next to `captureException(contactError, …)` in the `catch (contactError)` block and next to `captureException(error)` in the outer catch, add:
  - `if (process.env.NODE_ENV !== "production") console.error("[booking] guest_contacts upsert failed", describeError(contactError));` and `console.error("[booking] checkout creation failed", describeError(error));`.
- Add a small unexported `describeError(error: unknown)` in `actions.ts` that returns `{ code, message }` when the value has them (Postgrest errors) and `{ message }` for plain `Error`s, and nothing else. Do **not** log `details` (it contains the email) or the raw error object.
- User-facing copy is unchanged.

### 5. Update and extend the unit tests

In `apps/website/src/lib/shared/__tests__/guest-contacts.unit.test.ts`:

- Add `vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn() }))` and spy on `console.warn` (restore in `afterEach`).
- Adapt existing tests to two lookups per resolution (email lookup stub, then phone lookup stub, then the write stub). Keep their intent: found-by-email-only updates with the new phone; found-by-phone-only updates with the new email; no row inserts; non-`23505` insert error throws; insert `23505` falls back to update.
- New cases:
  - **Two rows** (the bug): email lookup returns `{ id: "email-row" }`, phone lookup returns `{ id: "phone-row" }`, update succeeds → returns `"email-row"`; `update` called once with an object that has no `phone` key but includes `email`, `guest_name`, `enabled`; `eq` called with `("id", "email-row")`; nothing called with `"phone-row"`; `console.warn` called exactly once with both ids and no phone/email string in its arguments; `addBreadcrumb` called once.
  - **Same row**: both lookups return `{ id: "same-row" }` → full update including `phone` and `email`, no warn.
  - **Phone row only, email free**: update includes the new `email`.
  - **Update-time `23505`**: first resolution sees only the phone row (stale), update returns `{ code: "23505" }`; re-resolution sees email row + phone row; second update on the email row without `phone` succeeds → returns the email row's id, does not throw.
  - **Update-time `23505` twice** → throws the `23505` error (one retry only, no loop).
- **Negative check**: temporarily make the two-row branch pass full `fields` (no stripping) and have the update stub return `{ code: "23505" }` whenever the payload contains `phone` while the target is the email row; confirm the two-row test fails with the `23505`. Revert, and state in the implementation report that it was tried and reverted.

### 6. Add the Playwright regression spec

Create `apps/website/e2e/booking-split-guest-contact.integration.spec.ts`, modelled on the "full booking flow" test in `booking-flow.integration.spec.ts`:

- Use dates distinct from the other spec to avoid availability interference (e.g. `addDays(today, 20)` to `addDays(today, 22)`).
- Seed with `createAdminClient()`:
  - phone row: `phone: "+351" + nineDigits` (nine random digits from `randomUUID()`), unique random email, `guest_name: "E2E Split Phone Row"`, `enabled: false`.
  - email row: `email: "e2e-split-<uuid>@example.com"`, `phone: null`, `guest_name: "E2E Split Email Row"`, `enabled: false`.
- `page.route("https://checkout.stripe.com/**", …)` fulfilled with a fake page, exactly as the existing spec.
- Open `/booking/room1`, expand, pick the two dates, fill name, the email row's email and the nine digits as WhatsApp number, click "Confirm booking", and `waitForURL("https://checkout.stripe.com/**")`.
- Assert with the admin client afterwards: the phone row still has its original phone and email (untouched); the email row's `phone` is still `null`; the pending `bookings` row for this checkout references the email row's id (`guest_contact_id`).
- `finally`: delete `bookings` rows whose `guest_contact_id` is either seeded id, then delete both `guest_contacts` rows. Never reset the database.
- Before the fix this spec fails (the form shows "Failed to create checkout session" and no navigation happens); after it, it passes.

### 7. Run the validation commands

- Run every command in `Validation Commands` and fix anything that fails.

## Test Coverage

- `apps/website/src/lib/shared/__tests__/guest-contacts.unit.test.ts` (`*.unit.test.ts`, gated in CI and pre-push): the two-row case must return the email row's id, update it without `phone`, and warn once; the update-time `23505` must fall back instead of throwing. Against the unfixed code the two-row test fails (single `.or` lookup, full-field update, `23505` rethrown), which is what stops the bug returning. Same-row, email-only, phone-only, no-row and insert-race cases lock in unchanged behaviour.
- `apps/website/e2e/booking-split-guest-contact.integration.spec.ts` (Playwright, run by the ADW test phase, not CI): proves the user-visible journey, a guest whose phone and email live on two rows reaches Stripe Checkout, against the real local Postgres constraints that the unit stub can only simulate.
- No test for the dev-only `console.error` in `actions.ts`: it is a logging-only change behind `NODE_ENV`, with no behaviour a user or caller can observe; verified manually in the dev terminal.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- Before the fix (reproduce): `yarn workspace website vitest run --project unit src/lib/shared/__tests__/guest-contacts.unit.test.ts` with only the new tests from Task 5 added - the two-row and update-time `23505` tests fail with `23505`.
- After the fix: the same command - all tests pass.
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace (including the unchanged callers in the Stripe webhook and direct-booking route)
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the bug is fixed with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds
- Manual on local (shared Supabase, no reset): reproduce the Steps to Reproduce with a phone on one row and an email on another → Stripe Checkout opens, and the dev terminal shows the single `[guest-contacts] … different rows` warning with two ids and no PII.

## Notes

- No new dependency: `@sentry/nextjs` is already a website dependency (`addBreadcrumb` is already used in `actions.ts` and the Stripe webhook).
- No migration and no change to the unique constraints (out of scope per the issue). `guest_name_normalized` is also unique but the website never writes it, so it is not a collision source here.
- Only `apps/website` is touched. GCA's own `guest_contacts` writes (upsert by phone) are out of scope, and the phone row is deliberately left alone because GCA keys WhatsApp history by phone.
- The two-row case leaves a split contact in the database on purpose; the `console.warn` plus Sentry breadcrumb (with both ids) is the owner's cue to merge by hand in Supabase Studio. A merge UI is out of scope.
- Email matching stays exact (case-sensitive), as today; normalising emails is a separate change.
- The Stripe webhook caller now also survives the split-contact case instead of returning 500 and being retried by Stripe indefinitely.
