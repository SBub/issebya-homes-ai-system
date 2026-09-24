# Shop Seller Submission Form (`/shop/sell`)

**ADW ID:** 7d77143c
**Date:** 2026-09-24
**Specification:** specs/issue-139-adw-7d77143c-sdlc_planner-shop-seller-submission-form.md

## Overview

Outside sellers can offer a piece for the shop through one page, `/shop/sell`: contact details, a description of the piece (title, maker, materials, dimensions, condition, asking price, description), 1 to 6 photos and a consent tick. Photos go from the browser straight into a private Supabase Storage bucket through server-minted signed upload URLs (Vercel caps request bodies at 4.5 MB, so a Server Action can't carry them). The submission is stored in `public.shop_seller_submissions` and the owner is emailed a plain-text summary with 7-day photo links. She reviews it in Supabase Studio. This is the first use of Supabase Storage in the repo.

## What Was Built

- Static `/shop/sell` page with a `"use client"` `SellerForm` island (per-file validation, per-photo upload progress, honeypot, consent gate)
- Two-step Server Action flow: `prepareSellerPhotoUploads` then `submitSellerSubmission`
- Migration creating the `shop_seller_submissions` table and the private `seller-submissions` bucket
- Owner notification email (`sendSellerSubmissionNotificationEmail`) via Resend
- Shared `emailSchema` extracted from the wishlist module
- "Offer it here." link at the bottom of `/shop`, and `/shop/sell` in the sitemap
- CSP `connect-src` allowance for the configured Supabase origin
- `E2E_MOCK_RESEND` MSW mock so Playwright runs never email the owner

## Technical Implementation

### Files Modified

- `supabase/migrations/20260925120000_create_shop_seller_submissions.sql`: table (RLS on, zero policies, `anon`/`authenticated` revoked, `updated_at` trigger, `(status, created_at desc)` index) and the bucket (private, 5 MB, JPEG/PNG/WebP only, no `storage.objects` policies)
- `apps/website/src/lib/shop/seller-submission.ts`: pure module shared by client and server. Limits, bucket name, copy, Zod schemas (`sellerFieldsSchema`, `sellerSubmissionSchema`, photo meta), `eurosToCents`/`formatCents`, `photoObjectPath`/`isOwnPhotoPath`, form state types, `sellerFieldsFromFormData`
- `apps/website/src/app/(main)/shop/sell/actions.ts`: the two Server Actions
- `apps/website/src/app/(main)/shop/sell/page.tsx`: static server page and metadata
- `apps/website/src/app/(main)/shop/sell/ui/SellerForm.tsx`: form island built on `useActionState`, captures PostHog `seller_submission_created` (photo count and condition only)
- `apps/website/src/app/(main)/shop/sell/ui/upload-photo.ts`: XHR `PUT` wrapper (XHR because only it reports upload progress; kept separate so the browser test can mock it)
- `apps/website/src/lib/resend.ts`: `sendSellerSubmissionNotificationEmail`, plain text, `replyTo` the seller, throws on Resend's `{ error }`
- `apps/website/src/lib/shared/schemas/email.ts`: shared `emailSchema` (trim, lowercase, max 254, `z.email`), now also used by `wishlist.ts`
- `apps/website/src/proxy.ts`: adds the origin of `SUPABASE_URL` to `connect-src` (local Storage is `http://127.0.0.1:54321`, not `*.supabase.co`)
- `apps/website/src/instrumentation.ts`, `apps/website/playwright.config.ts`: `E2E_MOCK_RESEND` handler for `POST https://api.resend.com/emails`
- `apps/website/src/app/(main)/shop/page.tsx`, `apps/website/src/app/sitemap.ts`: sell link and sitemap entry
- `apps/website/vitest.config.ts`: `resend` added to browser `optimizeDeps.include`

### Key Changes

- **Server picks every path.** `prepareSellerPhotoUploads` validates the text fields and photo metadata first, and only then allocates `submissionId = crypto.randomUUID()` and mints one `createSignedUploadUrl` per photo at `<submissionId>/<index>.<ext>`. The bucket name is never part of the path. It never mints more than 6.
- **Nothing the browser claims is trusted.** `submitSellerSubmission` re-validates the fields, rejects any path that fails `isOwnPhotoPath` (exact `<submissionId>/<0-5>.<jpg|png|webp>`), then lists the bucket prefix and checks that each object exists with an allowed `mimetype` and `size` of 5 MB or less before inserting.
- **Row id = submission id.** A duplicate insert (`23505`, from a double submit or retry) counts as success. A failed upload makes the form ask for fresh URLs under a new id, so orphaned objects can be left in the bucket.
- **Email is best effort.** The row is inserted first. Signing the download URLs and sending the email run in a `try` whose failure is logged and sent to Sentry, but still returns `ok: true`.
- **Honeypot** (DOM field `website`) returns the success shape from both actions and mints nothing. Only the submission id, photo count and condition reach Sentry, never seller PII.

## How to Use

1. On `/shop`, follow "Have a piece that belongs in the house? Offer it here." to `/shop/sell`.
2. Fill in name, email (phone optional), title, materials, condition, asking price in euros (`120`, `120.50` or `120,50`) and a description of at least 20 characters.
3. Add 1 to 6 JPEG/PNG/WebP photos, each 5 MB or less. Bad files are flagged as soon as they are chosen.
4. Tick the contact consent and submit. Progress bars show each upload, then a thank-you message.
5. Owner: open Supabase Studio, `shop_seller_submissions`, and set `status` (`new`, `reviewing`, `accepted`, `rejected`) and `owner_notes`. Photos are in the `seller-submissions` bucket. Accepted pieces are added to `src/lib/shop/products.ts` by hand.

## Configuration

- No new env vars. Uses the existing `SUPABASE_URL` / service-role key, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `ADMIN_NOTIFICATION_EMAIL`. If `ADMIN_NOTIFICATION_EMAIL` is unset, no email is sent. If `RESEND_FROM_EMAIL` is missing, the send throws, which gets reported and swallowed.
- Apply the migration locally with `yarn supabase migration up` from the repo root. Never `db reset` the shared instance.
- `supabase/config.toml` already has `[storage] enabled = true`.

## Testing

- Unit: `src/lib/shop/__tests__/seller-submission.unit.test.ts` (schemas, price parsing, path checks), `src/app/(main)/shop/sell/__tests__/actions.unit.test.ts` (honeypot, path refusal, listing checks, duplicate insert, email failure), `src/lib/__tests__/resend.unit.test.ts`.
- Browser: `src/app/(main)/shop/sell/ui/SellerForm.browser.test.tsx` (mocks `../actions` and `upload-photo`).
- E2E (not gating): the `Seller submission` block in `e2e/shop.integration.spec.ts` covers the shop link, a real two-photo submission against local Supabase, and a check that anon cannot read the table. Resend is mocked.

## Notes

- A piece's submission never touches the static product registry.
- Orphaned photos (from an upload that failed partway, or an abandoned finalize) are not cleaned up yet.
- Preview deployments need the migration applied to whatever database they point at, or the bucket and table won't exist. See `app_docs/database/production-migrations.md`.
