# Guest Contact Upsert: Split Phone/Email Rows

**ADW ID:** 0a3bfba6
**Date:** 2026-09-30
**Specification:** specs/issue-199-adw-0a3bfba6-sdlc_planner-fix-guest-contact-upsert-collision.md

## Overview

Checkout on `/booking/[type]` failed with "Failed to create checkout session" when the guest's WhatsApp number belonged to one `guest_contacts` row and their email to a different one. `upsertGuestContact` picked one of the two rows at random and wrote both unique keys onto it, so Postgres rejected the write with `23505` on `guest_contacts_email_key`. The upsert now resolves the row deterministically, never writes a key another row owns, and retries once on a unique violation, so a returning guest can always pay.

## What Was Built

- Two exact lookups (`findByEmail`, then `findByPhone`) replacing the single `.or("phone.eq…,email.eq…").limit(1)` query.
- A `resolveTarget` step that picks the row to write and which fields are safe to write.
- A split-row path: when phone and email hit two different rows, the email row is updated without `phone`, the phone row is left alone, and a `console.warn` plus a Sentry breadcrumb record both row ids (no PII) so the owner can merge them by hand.
- One shared `23505` recovery for both update and insert: re-resolve once, write once more, then throw.
- Dev-only `console.error` in `submitBooking`'s two catch blocks, so failures that Sentry swallows locally are visible in the terminal.
- A Playwright regression spec that seeds a split contact and checks checkout reaches (mocked) Stripe.

## Technical Implementation

### Files Modified

- `apps/website/src/lib/shared/guest-contacts.ts`: new `findByEmail`, `findByPhone`, `resolveTarget` and `write` helpers; `upsertGuestContact` rewritten around them. Exported signature and return type unchanged.
- `apps/website/src/app/(main)/booking/[type]/actions.ts`: `describeError` helper and `NODE_ENV !== "production"` `console.error` next to both `captureException` calls.
- `apps/website/src/lib/shared/__tests__/guest-contacts.unit.test.ts`: stubs moved to two lookups per resolution; new split-row, same-row and update-time `23505` cases.
- `apps/website/e2e/booking-split-guest-contact.integration.spec.ts` (new): end-to-end regression against the real local constraints.

### Key Changes

- **Resolution rules.** Same row for both keys, or only one key taken: full update of that row (the free key is written onto it). Two different rows: update the email row with every field except `phone`. No row: insert.
- **Why the email row wins.** It is the row bookings link to via `bookings.guest_contact_id`. The phone row is never edited or deleted because GCA keys WhatsApp history by phone.
- **Retry.** A `23505` from either write (a concurrent insert, or a lookup that went stale) triggers one fresh `resolveTarget` and one more `write`. A second failure, or any non-`23505` error, is thrown. There is no loop.
- **Logging.** The split-row warning and breadcrumb carry `emailRowId` and `phoneRowId` only. `describeError` logs `code` and `message` only, never the Postgrest `details` (which contains the email).
- **Side benefit.** The two other callers, the Stripe webhook and `api/bookings/direct`, no longer throw on split contacts. The webhook used to return 500 and be retried by Stripe indefinitely.

## How to Use

Nothing changes for callers: keep calling `upsertGuestContact(params)` and use the returned id as `guest_contact_id`.

When the dev terminal or Sentry shows `[guest-contacts] phone and email belong to different rows…` / the `split guest contact` breadcrumb:

1. Take the two ids from the log.
2. Open both rows in Supabase Studio.
3. Merge by hand if they are the same guest. Bookings already point at the email row.

## Configuration

None. No migration, no env var, no change to the unique constraints.

## Testing

- Unit: `yarn workspace website vitest run --project unit src/lib/shared/__tests__/guest-contacts.unit.test.ts`.
- E2E (ADW test phase, not CI): `apps/website/e2e/booking-split-guest-contact.integration.spec.ts`. It seeds a phone-owning row and an email-owning row, books with both, and asserts navigation to Stripe, the phone row untouched, the email row's `phone` still null, and the pending booking linked to the email row. It cleans up its own rows; never reset the shared Supabase.
- Manual: follow the spec's Steps to Reproduce; Stripe Checkout should open and the terminal should show one split-row warning with two ids.

## Notes

- The split contact is left in the database on purpose. There is no merge UI.
- Email matching is still exact and case-sensitive.
- GCA's own `guest_contacts` writes (upsert by phone) are out of scope.
- Removing the `.or(...)` filter also stops user input from being interpolated into a PostgREST filter string.
