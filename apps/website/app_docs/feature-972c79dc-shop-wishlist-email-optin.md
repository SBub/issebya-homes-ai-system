# Shop wishlist with email and marketing opt-in

**ADW ID:** 972c79dc
**Date:** 2026-09-24
**Specification:** `specs/issue-138-adw-972c79dc-sdlc_planner-shop-wishlist-email-optin.md`

## Overview

`/shop` was a static catalogue, so the owner had no way to learn which pieces
visitors wanted or to reach them later. A product details page now has an
text wishlist button that opens an inline form: email, a marketing opt-in
checkbox, and a submit that stays disabled until the box is ticked. A Server
Action records the consent (with the exact sentence shown) and the wish in two
service-role-only tables, which the owner reads in Supabase Studio.

## What Was Built

- Two new tables, `shop_wishlist_contacts` (one row per consenting email) and
  `shop_wishlist_items` (one row per email + product slug), locked to the
  service role
- A pure copy + Zod schema module for the form (`src/lib/shop/wishlist.ts`)
- The `addToWishlist` Server Action: validate, honeypot, upsert consent,
  insert the wish, treat a repeat wish as success
- The `WishlistForm` client island rendered under the price on
  `/shop/[slug]`, with a `localStorage` email prefill and PostHog events
- A note in the product registry that slugs are now stable identifiers
- Unit, browser and Playwright tests

## Technical Implementation

### Files Modified

- `supabase/migrations/20260924120000_create_shop_wishlist.sql`: both tables,
  check constraints (`marketing_opt_in = true`, `email = lower(btrim(email))`),
  `on delete cascade` from contact to items, a `product_slug` index for "who
  wants this piece", an `updated_at` trigger, RLS on with no policies, and
  `anon`/`authenticated` revoked.
- `apps/website/src/lib/shop/wishlist.ts`: copy constants
  (`WISHLIST_OPT_IN_COPY`, `WISHLIST_OPT_IN_HELPER`, `WISHLIST_SUCCESS_COPY`,
  `WISHLIST_ERROR_COPY`), `wishlistSchema`, `WishlistFormState`,
  `initialWishlistState`, and `wishlistInputFromFormData`. Imports only `zod`
  and the registry, so it runs in the node test pool.
- `apps/website/src/app/(main)/shop/[slug]/actions.ts`: the `"use server"`
  action, wrapped in a Sentry `shop.wishlist.add` span.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.tsx`: the
  `"use client"` island using `useActionState`.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx`: renders
  `<WishlistForm productSlug={product.slug} />`. The page stays a prerendered
  Server Component.
- `apps/website/src/lib/shop/products.ts`: docblock note on slug stability.
- Tests: `src/lib/shop/__tests__/wishlist.unit.test.ts`,
  `src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts`,
  `src/app/(main)/shop/[slug]/ui/WishlistForm.browser.test.tsx`, and a new
  `Wishlist` block in `e2e/shop.integration.spec.ts`.

### Key Changes

- **Consent is enforced in three places.** The UI disables submit until the
  box is ticked, the schema requires `marketingOptIn: z.literal(true)`, and
  the table has a check constraint. The stored `opt_in_copy` is always the
  server-side constant, never a value from the form, so the recorded wording
  is what the visitor actually saw.
- **Consent first, then the wish.** The action upserts the contact (on
  conflict `email`, refreshing `opted_in_at` and the copy), then inserts the
  item. A `23505` unique violation on the item means the wish already exists
  and returns the same success. Any other DB error goes to Sentry
  `captureException` and returns `WISHLIST_ERROR_COPY`. Only the slug is sent
  to Sentry, never the email.
- **Honeypot.** A hidden `website` field. If it is filled the action returns
  the success shape without touching the DB, checked before any other field so
  a bot cannot tell which field gave it away.
- **Nothing leaks to the browser.** The action returns only the attempt
  counter, field errors, a general error, and the visitor's own email (echoed
  so the uncontrolled input can be re-keyed after React's form reset). `anon`
  gets `42501` on both tables, not an empty result.
- **Prerender-safe prefill.** `localStorage` is read in the button's click
  handler, never during render, so hydration matches the static HTML. After a
  successful save the email is remembered; the checkbox starts ticked only if
  this browser already consented with that same email. Storage failures are
  swallowed and the form still works.
- `guest_contacts` is deliberately not used: it is keyed by phone, which a
  wishlist visitor never gives.

## How to Use

1. Open any product at `/shop/<slug>` and press "Save to wishlist".
2. Enter an email and tick "Keep me posted about new pieces and the
   occasional offer from the house." Until it is ticked, "Save to wishlist" is
   disabled and a helper line explains why.
3. Submit. The form is replaced by "Saved. We'll let you know about it."
   Saving the same product again shows the same message and stores nothing
   new.
4. The owner sees who wants what in Supabase Studio: filter
   `shop_wishlist_items` by `product_slug`, and join to
   `shop_wishlist_contacts` for the consent record.

PostHog receives `wishlist_form_opened` and `wishlist_item_added`, each with a
`product_slug` property and no email.

## Configuration

No new environment variables. The action uses the existing
`createAdminClient()` (service role). The migration needs no grants: the
default privileges from `20260828120000_grant_service_role_all_public.sql`
already cover `service_role`. Locally, apply it with
`yarn supabase migration up` from the repo root, never a reset. It reaches
production through the usual migration gate (see
`app_docs/database/production-migrations.md`).

## Testing

- `test:unit` (from `apps/website`): schema tests (normalisation, unknown
  slug, opt-in must be `true`, honeypot, form-data mapping) and action tests
  against a mocked admin client (consent before item, consent copy taken from
  the server, duplicate as success, unknown slug / unticked opt-in / honeypot
  make no DB call, a failed consent upsert stores no wish, only the form state
  shape comes back).
- `test:browser`: the form component, with `../actions`, Sentry and PostHog
  mocked (open event, disabled submit + helper, success + remembered email,
  prefill from `localStorage`).
- `e2e/shop.integration.spec.ts` (Playwright, local only, does not gate CI):
  wishes the same product twice under a unique email and asserts one item row
  and one consent row, checks the prefill after reload, and asserts `anon`
  gets `42501` on both tables. It deletes its contact afterwards; items
  cascade.

## Notes

- The product slug is the only identity. There is no foreign key to the
  static registry, so renaming a slug orphans every wish recorded against it.
  Migrate `shop_wishlist_items` rows in the same PR if a rename is ever needed.
- The remembered email and consent in `localStorage` are a convenience only.
  Every submit re-sends the checkbox and the server re-validates and
  re-records consent.
- `ProductCard` was intentionally left alone: a form inside the card's link
  would be invalid HTML.
- Not built: sending any email, unsubscribe handling, or showing a visitor
  their own wishlist.
