# Shop Wishlist: Labelled Button and a Real Unsubscribe Link

**ADW ID:** 3b203d9a
**Date:** 2026-09-24
**Specification:** specs/issue-147-adw-3b203d9a-sdlc_planner-wishlist-button-unsubscribe-link.md

## Overview

Follow-up to #143 (see `feature-bcb9a5cf-wishlist-heart-modal-email.md`). The icon-only heart on `/shop/[slug]` becomes a labelled outline button ("Add to wishlist" / "Added to wishlist"), and the confirmation email's "Reply to this email to stop these" promise is replaced by a working unsubscribe link. Clicking it flips the contact to unsubscribed in the database without deleting the contact or any wished item, and re-consenting later rotates the token so an old email's link can never undo the new consent.

## What Was Built

- Labelled wishlist trigger: heart icon plus visible text, which is also the accessible name (no `aria-label`)
- A shared `.button-outline` CSS recipe, extracted from `.booking-close-button`
- Schema: per-contact `unsubscribe_token` and `unsubscribed_at`, with a two-state consent CHECK
- `/shop/wishlist/unsubscribe?token=…` Route Handler that unsubscribes and 303-redirects to a token-free result page
- Three noindex result pages: `/done`, `/already`, `/invalid` (the last answers a real 404)
- Token rotation on re-consent inside `addToWishlist`; email sent on a new wish or a renewed consent
- Email footer with the unsubscribe link, plus a `List-Unsubscribe` header
- A Sentry scrubber that removes the token from events and transactions

## Technical Implementation

### Files Modified

- `supabase/migrations/20260926120000_add_shop_wishlist_unsubscribe.sql`: adds `unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex')` and `unsubscribed_at timestamptz`, replaces `shop_wishlist_contacts_consent_required` with `shop_wishlist_contacts_consent_state`. The header comment documents the state model and supersedes the original migration's "no access_token" note.
- `src/lib/shop/unsubscribe.ts` (new): `newUnsubscribeToken`, `isUnsubscribeToken` (64 lowercase hex), `unsubscribeUrl` (the one place the link shape lives), `resolveUnsubscribe`, `unsubscribeResultPath`, `scrubUnsubscribeToken`. Node-pool testable.
- `src/app/(main)/shop/wishlist/unsubscribe/route.ts` (new): `GET` handler. A repeated `token` param counts as invalid.
- `src/app/(main)/shop/wishlist/unsubscribe/{done,already,invalid}/page.tsx` + `invalid/not-found.tsx` + `ui/UnsubscribeMessage.tsx` (new): result pages sharing one presentational block; they differ only in copy.
- `src/lib/shop/wishlist.ts`: removes `WISHLIST_EMAIL_STOP_LINE`; adds the unsubscribe line, result-page copy and button label constants; the email builder takes `unsubscribeUrl`; new pure `wishlistContactUpsert` payload builder.
- `src/app/(main)/shop/[slug]/actions.ts`: pre-reads the contact, builds the upsert with `wishlistContactUpsert`, reads the stored token back from the upsert, emails when `marketing_opt_in && (created || reconsented)`.
- `src/lib/resend.ts`: `sendWishlistConfirmationEmail` takes `unsubscribeToken`, puts the URL in the body and in `List-Unsubscribe`.
- `src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx`, `page.tsx`: labelled button; price row gets `flex-wrap`.
- `src/app/globals.css`, `booking/[type]/ui/BookingEngineExpanded.tsx`: `.button-outline` extraction; the booking Close button now uses `booking-close-button button-outline` and looks unchanged.
- `sentry.server.config.ts`: `beforeSend` / `beforeSendTransaction` run the scrubber.
- `README.md`: route table row and a "Wishlist consent" section.

### Key Changes

- **Consent state is enforced in the DB.** Subscribed is `marketing_opt_in = true, unsubscribed_at is null`; unsubscribed is `false, not null`. Any other combination is rejected. Unsubscribing never deletes, so the owner sees who opted out and when in Studio.
- **Route Handler, not a page.** With `cacheComponents`, a page can only read `searchParams` under `<Suspense>`, and once streaming starts the status is fixed at 200, so a redirect would become client-side and render the token URL (and send it to PostHog). The handler renders nothing and answers a real 303 to a token-free path for every outcome, including `invalid`, whose page calls `notFound()` for a real 404. This departs from the spec, which planned a Server Component `page.tsx`.
- **Race-safe unsubscribe.** `resolveUnsubscribe` looks the row up, then updates with `.is("unsubscribed_at", null)`; zero rows updated (a concurrent click won) is answered `already`. Errors carry only the Postgres code, never the token.
- **Token rotation.** A subscribed contact keeps its token so links in emails they already have keep working. An unsubscribed contact consenting again gets `unsubscribed_at: null` and a fresh `randomBytes(32)` token. A new contact takes the column default.
- **Token never leaves the server path.** It is never logged or tagged, never appears in a rendered page or the final address bar, and the Sentry scrubber redacts `token=` in `request.url`, `request.query_string`, `transaction`, span descriptions and URL span-data keys, only for events that mention the unsubscribe path.

## How to Use

1. On a product page, click "Add to wishlist", enter an email, tick the consent box and save. The button reads "Added to wishlist" with a filled heart.
2. The confirmation email ends with `If you'd rather not receive these emails, unsubscribe here: <link>`. Mail clients may also offer their own unsubscribe via the `List-Unsubscribe` header.
3. Following the link lands on "You're unsubscribed. We won't email you about the wishlist any more." Following it again shows "You're already unsubscribed."
4. Wishing again with the box ticked re-subscribes the guest, sends a fresh email with a new link, and the old link now shows "This link isn't valid." (404).

## Configuration

- Apply the migration locally with `cd apps/website && yarn supabase migration up` (never `db reset`). It reaches prod through the migrations workflow.
- `SITE_URL` sets the link origin. No new environment variables or dependencies.
- Only `sentry.server.config.ts` has the scrubber; the edge config is unchanged because the route does not run on the edge.

## Testing

- `src/lib/shop/__tests__/unsubscribe.unit.test.ts`: token shape, resolver outcomes (unsubscribed, already, race, invalid, malformed input with no DB call, error message without the token), the old-link-dies-on-re-consent case, and scrubber coverage.
- `src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts`: rotation on re-consent, one email on a renewed consent for an already-wished product, a subscribed contact keeping its token, nothing stored when the pre-read fails.
- `src/lib/shop/__tests__/wishlist.unit.test.ts`, `src/lib/__tests__/resend.unit.test.ts`, `WishlistDialog.browser.test.tsx`: email footer and header, button accessible name.
- `e2e/shop.integration.spec.ts` (not in CI): malformed link lands on `/invalid` with a 404; full flow of unsubscribe, item kept, already, re-consent, old link dead.
- Run with `yarn turbo run test --filter=./apps/website`.

## Notes

- **Panel vs email on re-consent.** When an unsubscribed guest re-wishes a product they already wished, a new email goes out but `created` is false, so the panel does not show the "We've sent a note to …" line. `WishlistFormState` was deliberately left unchanged.
- The action never writes `marketing_opt_in: false`; only the unsubscribe route does.
- Vercel request logs still see the token URL, like any query-string token (bookings' `access_token` has the same property).
- Out of scope: `List-Unsubscribe-Post` one-click POST, preference centre, per-topic consent, double opt-in, marketing sends.
