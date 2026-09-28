# Feature: Shop seller submission form (`/shop/sell`)

## Metadata

issue_number: `139`
adw_id: `7d77143c`
issue_json: `{"number":139,"title":"Shop: sellers can submit a piece (photos, details, materials, price, contact) through a form; the owner reviews submissions in Supabase Studio"}`

## Feature Description

Outside sellers can offer a piece for the issebya.homes shop through one page, `/shop/sell`. They give their contact details (name, email, optional phone), describe the piece (title, maker or brand, materials, dimensions, condition, asking price in euros, a description), attach 1 to 6 photos, and tick a consent box. On submit the photos go from the browser straight into a private Supabase Storage bucket through server-minted signed upload URLs. A second Server Action checks that the photos are really there, records one row in `public.shop_seller_submissions`, and emails the owner a plain-text summary with 7-day signed download links for each photo. The owner reviews and decides in Supabase Studio (`status`, `owner_notes`). Nothing a submission does touches the static product registry. Accepted pieces are added to `products.ts` by hand later.

This is the first use of Supabase Storage in the repository.

## User Story

As an outside seller with a piece that could belong in the house
I want to send photos, details and my asking price through one simple form
So that the owner can look at it and get back to me, without me needing an account or an email back-and-forth.

## Problem Statement

`/shop` is a static, hand-curated registry. Sellers have no way to offer a piece except ad-hoc messages, which arrive without photos, materials, dimensions or price in any consistent form. The owner has nowhere to track these offers or record her decision.

Vercel serverless request bodies are capped (documented at 4.5 MB), so a Server Action that receives up to six photos of up to 5 MB each is the wrong transport. The files have to go straight from the browser to Storage.

## Solution Statement

A two-step, server-controlled upload:

1. **`prepareSellerPhotoUploads(fields, photosMeta)`** (Server Action). Validates the text fields and photo metadata (count, mime, size) with Zod. Only if all of them pass: allocates a `submissionId` (`crypto.randomUUID()`), picks each object path itself (`<submissionId>/<index>.<ext>`, extension from the mime type, never prefixed with the bucket name), and mints one `createSignedUploadUrl` per photo with the service-role client (at most 6). Returns `{ submissionId, uploads: [{ path, signedUrl, token }] }`, or field errors. A filled honeypot returns the "done" shape and mints nothing.
2. The browser `PUT`s each file to its signed URL with `XMLHttpRequest`, so each file can show upload progress.
3. **`submitSellerSubmission(fields, submissionId, photoPaths)`** (Server Action). Re-validates everything. Refuses any path outside `<submissionId>/` or not matching the server's own path shape. Lists `storage.from("seller-submissions").list(submissionId)` and refuses paths that do not exist, or whose recorded `metadata.size`/`metadata.mimetype` break the limits. Inserts the row with `id = submissionId`, then sends the owner email with signed download URLs (7 days). A failed email is logged and sent to Sentry but does not fail the submission.

The bucket (private, 5 MB cap, image mimes only) and the table (RLS on, `anon`/`authenticated` revoked, no policies) are created by one migration. Pure schemas, constants and copy live in `src/lib/shop/seller-submission.ts` so they run in the node test pool and are shared by client and server, following `src/lib/shop/wishlist.ts`.

Two supporting changes the feature needs to work at all:

- **CSP `connect-src`** in `src/proxy.ts` only allows `https://*.supabase.co`. Locally (and in the Playwright run) Storage is `http://127.0.0.1:54321`, so the browser `PUT` would be blocked. Add the origin of `SUPABASE_URL` to `connect-src`.
- **Resend in the E2E run.** `.env.development` sets `RESEND_API_KEY` and `ADMIN_NOTIFICATION_EMAIL`, so the Playwright spec would send a real email to the owner on every run. Add an opt-in `E2E_MOCK_RESEND` MSW handler in `src/instrumentation.ts` next to `E2E_MOCK_STRIPE`, and turn it on in `playwright.config.ts`.

## Relevant Files

Use these files to implement the feature:

- `README.md`, `AGENTS.md`: repo conventions (yarn only, conventional commits, never reset the shared Supabase).
- `docs/conditional-docs.md`: doc index. Add an entry for this feature's doc when documenting.
- `apps/website/AGENTS.md`: read the Next docs in `node_modules/next/dist/docs/` first. Use server components by default. No Radix. Know which test layers gate (unit + browser gate, `e2e/` does not).
- `apps/website/ENGINEERING.md`: test layers and page rendering.
- `apps/website/app_docs/nextjs-patterns-guide.md`: new route plus Server Actions.
- `apps/website/app_docs/data-fetching-client.md`: mutations in Server Actions only.
- `apps/website/app_docs/client-form-guide.md`, `apps/website/app_docs/form-re-render-strategy.md`: `useActionState` form conventions.
- `apps/website/app_docs/zod-validation-guide.md`: schema conventions.
- `apps/website/app_docs/import-patterns-guide.md`: destructured imports.
- `apps/website/app_docs/environment-setup.md`: env handling (no new env vars; `SUPABASE_URL` read in `proxy.ts`).
- `apps/website/app_docs/branding-guidelines.md`: seller-facing copy tone. No em-dashes in copy.
- `apps/website/app_docs/database/database-interaction-rules.md`: read before the migration.
- `apps/website/app_docs/database/production-migrations.md`: how the migration reaches prod, and the preview-DB question in the manual check.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `component_test_spec_format.md`, `e2e_example.md`: test formats.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`: the closest precedent (honeypot, consent, service-role table, state shape, prerender-safe client island).
- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md`: `/shop` structure and sitemap.
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`, `node_modules/next/dist/docs/01-app/02-guides/forms.md`: Server Functions, `useActionState`, file inputs (paths from the repo root).
- `apps/website/src/app/(main)/shop/[slug]/actions.ts`: pattern to copy for a `"use server"` action (Sentry `startSpan`, honeypot first, `formatZodErrors`, `captureException` with `db.operation` tag, never send PII to Sentry).
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.tsx`: pattern for the client island (`useActionState` wrapper that captures PostHog on success, re-keyed inputs after React's form reset, off-screen honeypot, consent-gated submit).
- `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts`, `.../ui/WishlistForm.browser.test.tsx`: mocking patterns for the admin client, Sentry, PostHog and `../actions`.
- `apps/website/src/lib/shop/wishlist.ts`: pure copy + schema module pattern. Its email chain (trim, lowercase, max 254, `z.email`) is the "existing email schema" to reuse.
- `apps/website/src/app/(main)/booking/[type]/actions.ts`, `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx`: labelled inputs (`booking-name-label` style ids), per-field errors.
- `apps/website/src/lib/resend.ts`: add `sendSellerSubmissionNotificationEmail` next to `sendBookingNotificationEmail`.
- `apps/website/src/lib/shared/supabase.ts`: `createAdminClient()` (service role). Also used by Storage.
- `apps/website/src/lib/shared/validation.ts`: `formatZodErrors`.
- `apps/website/src/app/(main)/shop/page.tsx`: add the one link line at the bottom.
- `apps/website/src/app/sitemap.ts`: add `/shop/sell` to `staticRoutes`.
- `apps/website/src/proxy.ts`: CSP `connect-src` must allow the Supabase origin the browser uploads to.
- `apps/website/src/instrumentation.ts`: add the `E2E_MOCK_RESEND` handler.
- `apps/website/playwright.config.ts`: add `E2E_MOCK_RESEND: "true"` to `webServer.env`.
- `apps/website/e2e/shop.integration.spec.ts`: extend it with a `Seller submission` block.
- `apps/website/vitest.config.ts`: browser `optimizeDeps.include`. Add any new dependency the browser test pulls in (none expected).
- `supabase/config.toml`: `[storage] enabled = true` is already set (confirmed). No change.
- `supabase/migrations/20260924120000_create_shop_wishlist.sql`, `supabase/migrations/20260821120000_create_bookings_from_website.sql`: table/RLS/trigger pattern.
- `supabase/migrations/20260828120000_grant_service_role_all_public.sql`: default privileges already cover `service_role` on new public tables. No grants needed.

### New Files

- `supabase/migrations/20260925120000_create_shop_seller_submissions.sql`: table + trigger + bucket.
- `apps/website/src/lib/shared/schemas/email.ts`: `emailSchema` extracted from `wishlist.ts` (trim, lowercase, max 254, `z.email`), reused by wishlist and seller submission.
- `apps/website/src/lib/shop/seller-submission.ts`: constants, copy, Zod schemas, `eurosToCents`, path helpers, form state types.
- `apps/website/src/lib/shop/__tests__/seller-submission.unit.test.ts`
- `apps/website/src/app/(main)/shop/sell/actions.ts`: `prepareSellerPhotoUploads`, `submitSellerSubmission`.
- `apps/website/src/app/(main)/shop/sell/__tests__/actions.unit.test.ts`
- `apps/website/src/app/(main)/shop/sell/page.tsx`: static server page + metadata.
- `apps/website/src/app/(main)/shop/sell/ui/SellerForm.tsx`: `"use client"` form island.
- `apps/website/src/app/(main)/shop/sell/ui/upload-photo.ts`: `uploadPhoto(signedUrl, file, onProgress)` XHR `PUT` wrapper (kept separate so the browser test can mock it).
- `apps/website/src/app/(main)/shop/sell/ui/SellerForm.browser.test.tsx`
- `apps/website/src/lib/__tests__/resend.unit.test.ts` (or extend an existing one if present): the email body and error behaviour.

## Implementation Plan

### Phase 1: Foundation

- Migration: table `public.shop_seller_submissions` plus the private `seller-submissions` bucket. Applied locally with `yarn supabase migration up` from the repo root. Never `supabase start`/`db reset`.
- Shared `emailSchema` extraction, then `src/lib/shop/seller-submission.ts` with every limit, the mime list, copy, schemas and pure helpers. Unit-tested first.

### Phase 2: Core Implementation

- The two Server Actions, with Sentry spans, the honeypot short-circuit, the server-chosen paths, prefix and existence checks, the insert, and best-effort email.
- `sendSellerSubmissionNotificationEmail` in `resend.ts` (plain `text`, checks Resend's `{ error }` and throws so the caller can report it).
- `SellerForm` client island and `upload-photo.ts`. `page.tsx` as a static server page.

### Phase 3: Integration

- Link line on `/shop`, sitemap entry, CSP `connect-src` for the Supabase origin, the `E2E_MOCK_RESEND` mock, and the Playwright spec.
- Documentation of the feature and a `conditional-docs.md` entry (the `/document` phase does this).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs this change depends on

- `apps/website/AGENTS.md`, the `app_docs` guides listed above, and `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` + `02-guides/forms.md` (Server Functions called with plain arguments outside a `<form>`, `useActionState`, file inputs).
- Check that `supabase/config.toml` `[storage] enabled = true` (it is). Do not change it.

### 2. Migration: table and bucket

Create `supabase/migrations/20260925120000_create_shop_seller_submissions.sql`. Pick a timestamp later than the newest existing migration. Add a header comment in the wishlist migration's style: who writes it (the `submitSellerSubmission` Server Action, service role), who reads it (owner in Studio), and why RLS has zero policies. Then:

```sql
create table public.shop_seller_submissions (
  id                  uuid         primary key default gen_random_uuid(),
  seller_name         text         not null check (char_length(seller_name) between 1 and 80),
  seller_email        text         not null check (seller_email = lower(btrim(seller_email))),
  seller_phone        text         check (seller_phone is null or char_length(seller_phone) between 5 and 30),
  title               text         not null check (char_length(title) between 1 and 80),
  maker_or_brand      text         check (maker_or_brand is null or char_length(maker_or_brand) <= 40),
  materials           text         not null check (char_length(materials) between 1 and 200),
  dimensions          text         check (dimensions is null or char_length(dimensions) <= 120),
  condition           text         not null check (condition in ('new','like_new','used','vintage')),
  asking_price_cents  integer      not null check (asking_price_cents >= 0),
  currency            text         not null default 'EUR',
  description         text         not null check (char_length(description) between 20 and 2000),
  photo_paths         text[]       not null check (array_length(photo_paths, 1) between 1 and 6),
  status              text         not null default 'new' check (status in ('new','reviewing','accepted','rejected')),
  owner_notes         text,
  contact_consent_at  timestamptz  not null,
  source              text         not null default 'shop_sell_form',
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);
alter table public.shop_seller_submissions enable row level security;
revoke all on public.shop_seller_submissions from anon, authenticated;
-- updated_at trigger: same function shape as update_shop_wishlist_contacts_updated_at (clock_timestamp()).
create or replace function public.update_shop_seller_submissions_updated_at() ...;
create trigger shop_seller_submissions_updated_at before update ... ;
-- "What's new to review?" is the owner's only query.
create index shop_seller_submissions_status_created_at_idx on public.shop_seller_submissions (status, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seller-submissions', 'seller-submissions', false, 5242880, array['image/jpeg','image/png','image/webp']);
```

- Empty optional text columns are stored as `null`, not `''`. The action maps `''` to `null`.
- No policies on `storage.objects`. The service role bypasses RLS, and every browser upload goes through a signed URL, which needs no policy. Say so in a comment.
- Comment in the SQL that object paths inside the bucket are `<submission id>/<index>.<ext>` and must never start with `seller-submissions/`.
- Apply locally: `yarn supabase migration up` (repo root). Check it:
  - `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'seller-submissions'` shows `public = false`.
  - As `anon`, a select on the table fails with `42501` (the Playwright spec asserts this too).

### 3. Extract the shared email schema

- Create `src/lib/shared/schemas/email.ts` exporting `emailSchema` = the chain currently inline in `wishlistSchema` (`z.string().trim().toLowerCase().max(254, …).pipe(z.email(…))`, same message).
- Change `src/lib/shop/wishlist.ts` to use it. The existing `wishlist.unit.test.ts` must still pass unchanged. That is the regression proof for the extraction.

### 4. `src/lib/shop/seller-submission.ts` (pure, node-pool safe)

File docblock like `wishlist.ts`: why it lives outside `actions.ts` (a `"use server"` file may only export async functions) and that it imports only `zod`. Contents:

- Constants: `SELLER_SUBMISSIONS_BUCKET = "seller-submissions"`, `MAX_PHOTOS = 6`, `MIN_PHOTOS = 1`, `MAX_PHOTO_BYTES = 5 * 1024 * 1024`, `ALLOWED_PHOTO_TYPES = ["image/jpeg","image/png","image/webp"] as const`, `PHOTO_EXTENSION: Record<type, "jpg"|"png"|"webp">`, `SELLER_CONDITIONS = ["new","like_new","used","vintage"] as const` plus display labels, `PHOTO_DOWNLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60`.
- Copy (no em-dashes): `SELL_LINK_COPY = "Have a piece that belongs in the house? Offer it here."`, `SELLER_CONTACT_CONSENT_COPY = "You can contact me about this piece."`, `sellerSuccessCopy(email)` → `"Thank you. Sveta will look at your piece and get back to you at ${email}."`, `SELLER_ERROR_COPY` (generic retry), `SELLER_UPLOAD_ERROR_COPY` (a photo failed to upload), photo error messages (`too many`, `none`, `too large (max 5 MB)`, `JPEG, PNG or WebP only`).
- `eurosToCents(input: string): number | null`. Accepts `^\d{1,7}([.,]\d{1,2})?$` after trimming. Converts by splitting on the separator and padding the fraction to 2 digits, so no float arithmetic. `"120"` → 12000, `"120.5"` → 12050, `"120,05"` → 12005. Returns `null` for `"12.345"`, `"12.3.4"`, `"-1"`, `"1e3"`, `""`. This is the one conversion point.
- `sellerFieldsSchema` (the text fields, camelCase in TS):
  - `name` trim 1–80
  - `email` = shared `emailSchema`
  - `phone` trim, `""` or 5–30 chars
  - `title` trim 1–80
  - `makerOrBrand` trim 0–40
  - `materials` trim 1–200
  - `dimensions` trim 0–120
  - `condition` `z.enum(SELLER_CONDITIONS)`
  - `askingPrice` string `.transform` via `eurosToCents`, adding a Zod issue ("Enter a price in euros, e.g. 120 or 120.50") on `null`. Output key stays `askingPrice`, and the action maps it to `asking_price_cents`.
  - `description` trim 20–2000
  - `contactConsent: z.literal(true, { error: … })`
  - `honeypot: z.string().max(0)`
    Errors are per field.
- `photoMetaSchema = z.object({ type: z.enum(ALLOWED_PHOTO_TYPES, …), size: z.number().int().positive().max(MAX_PHOTO_BYTES, …) })` and `photosMetaSchema = z.array(photoMetaSchema).min(1).max(6)`.
- `sellerSubmissionSchema = z.object({ fields: sellerFieldsSchema, photos: photosMetaSchema })`, the name the issue asks for.
- Path helpers:
  - `photoObjectPath(submissionId, index, type)` → `` `${submissionId}/${index}.${ext}` ``, never prefixed with the bucket.
  - `isOwnPhotoPath(submissionId, path)`: exact regex `^<uuid>/[0-5]\.(jpg|png|webp)$` with the uuid equal to `submissionId`. Rejects `..`, a leading `/`, a `seller-submissions/` prefix, and other ids.
- `checkPhotoFile(file: { type, size })` → error message or `null`. The client uses it for instant feedback. It is the same logic as `photoMetaSchema`.
- Types:
  - `SellerFields` (the raw client input, all strings plus `contactConsent: boolean`)
  - `SellerFieldErrors = Partial<Record<keyof SellerFields | "photos", string>>`
  - `PrepareResult = { kind: "invalid"; errors } | { kind: "upload"; submissionId; uploads: { path; signedUrl; token }[] } | { kind: "done" }` (`done` = honeypot)
  - `SubmitResult = { ok: true } | { ok: false; errors; generalError }`
  - `SellerFormState = { attempt; ok; errors; generalError; values: SellerFields }`. `values` echoes only the seller's own input so the uncontrolled inputs can be re-keyed after React's form reset (same reason as `BookingFormState.values`), and `initialSellerFormState`.
- Also export a `sellerFieldsFromFormData(formData)` mapper (honeypot input named `website`, consent `"on"`), shared by the form and tests, like `wishlistInputFromFormData`.

### 5. Unit tests for the pure module

`src/lib/shop/__tests__/seller-submission.unit.test.ts`:

- A valid submission (fields + 2 photos) parses. The email is normalised and `askingPrice` becomes cents.
- `eurosToCents` table: `"120"`, `"120.5"`, `"120.50"`, `"120,05"`, `"0"` accepted with exact cents. `"12.345"`, `"12.3.4"`, `"-5"`, `"abc"`, `""`, `"1e3"` rejected ("a price with cents entered wrongly").
- 0 photos and 7 photos are rejected with a `photos` error. A 6 MB photo (`6 * 1024 * 1024`) is rejected. `image/gif` and `application/pdf` are rejected. 5 MB exactly is accepted.
- Missing consent (`false`) is rejected. A filled honeypot makes a `honeypot` issue.
- Length bounds: title 81 chars, description 19 chars, phone 4 chars, and a bad condition value are each rejected.
- `photoObjectPath` never starts with the bucket name. `isOwnPhotoPath` accepts own paths and rejects another uuid, `seller-submissions/<id>/0.jpg`, `<id>/../x/0.jpg`, `<id>/6.jpg`, `<id>/0.gif`.

### 6. Owner notification email

In `src/lib/resend.ts` add `sendSellerSubmissionNotificationEmail(submission, photoUrls: string[])`:

- Returns early when `ADMIN_NOTIFICATION_EMAIL` is unset, same as `sendBookingNotificationEmail`. Throws on a missing `RESEND_FROM_EMAIL`.
- Plain `text:` body (no React template). Lines: seller name / email / phone (or "not given"), title, maker, materials, dimensions, condition label, price formatted `€120.50` from cents, description, then `Photo 1: <url>` per signed URL, then `Review in Supabase Studio → shop_seller_submissions`. Subject: `New shop submission: <title>`. Set `replyTo` to the seller's email so the owner can answer directly.
- Check the `{ error }` Resend returns and `throw` it. The existing booking helpers ignore it, which would hide a failure from the caller's Sentry report.
- Unit test (`src/lib/__tests__/resend.unit.test.ts`, mocking `resend`'s `Resend` class): the text contains every field, one line per photo URL, and the Studio line. Throws when Resend returns an error. No call when `ADMIN_NOTIFICATION_EMAIL` is unset.

### 7. Server Actions: `src/app/(main)/shop/sell/actions.ts`

`"use server"`. Both functions take plain arguments (Server Function arguments are untrusted client input, so both re-validate everything).

`prepareSellerPhotoUploads(fields: SellerFields, photosMeta: { type: string; size: number }[]): Promise<PrepareResult>`

1. `sellerSubmissionSchema.safeParse({ fields, photos: photosMeta })`.
2. A honeypot issue → `addBreadcrumb` and return `{ kind: "done" }`. Checked before anything else. No client created, nothing minted.
3. Other issues → `{ kind: "invalid", errors }` (first message per field, `photos.*` collapsed to `photos`). The admin client is never created, so no URLs are minted for invalid text (privacy/spam constraint).
4. Also reject `photosMeta.length > MAX_PHOTOS` before anything else, as a guard independent of the schema (limit of 6 URLs per request).
5. Inside `startSpan({ name: "shop.seller_submission.prepare", … attributes: { "shop.photoCount": n } })`: `submissionId = crypto.randomUUID()`. For each photo `i`, `path = photoObjectPath(submissionId, i, type)` and `createAdminClient().storage.from(SELLER_SUBMISSIONS_BUCKET).createSignedUploadUrl(path)` (no `upsert`). On any error, `captureException` with `tags: { "storage.operation": "create_signed_upload_url" }` and return `{ kind: "invalid", errors: {}, … }` with `SELLER_ERROR_COPY`. Model the general error as part of the `invalid` variant.
6. Return `{ kind: "upload", submissionId, uploads }`. Never include anything else: no bucket listings, no other ids.

`submitSellerSubmission(fields: SellerFields, submissionId: string, photoPaths: string[]): Promise<SubmitResult>`

1. Re-validate `fields` with `sellerFieldsSchema`. A honeypot → `{ ok: true }`, no DB. `submissionId` must be `z.uuid()`. `photoPaths` must be 1–6 unique strings.
2. **Prefix check**: every path must satisfy `isOwnPhotoPath(submissionId, path)`. Otherwise `captureException`/breadcrumb and return `{ ok: false, generalError: SELLER_ERROR_COPY }` with no insert. This is the check the negative test removes.
3. **Existence check**: `storage.from(bucket).list(submissionId, { limit: 100 })`. Build a map `` `${submissionId}/${obj.name}` `` → `obj.metadata`. Every claimed path must be present, with `metadata.size <= MAX_PHOTO_BYTES` and `metadata.mimetype` in `ALLOWED_PHOTO_TYPES` (the "server on the recorded metadata" check. The bucket enforces the hard cap anyway). Missing → `{ ok: false, generalError: SELLER_UPLOAD_ERROR_COPY }`.
4. Insert into `shop_seller_submissions` with `id: submissionId`, snake_case columns, `''` → `null` for phone/maker/dimensions, `asking_price_cents` from the parsed value, `photo_paths: photoPaths` (sorted by index), `contact_consent_at: new Date().toISOString()`, `source: "shop_sell_form"`. A `23505` on the pk means this submission was already recorded (double submit or retry): return `{ ok: true }` without sending a second email. Any other error → `captureException` (`db.operation: shop_seller_submissions_insert`) and `SELLER_ERROR_COPY`.
5. Email, best effort: `createSignedUrls(photoPaths, PHOTO_DOWNLOAD_URL_TTL_SECONDS)`, then `sendSellerSubmissionNotificationEmail`. Wrap both in `try/catch`. On failure `console.error` + `captureException` with `tags: { "email.type": "seller_submission_notification" }`, and still return `{ ok: true }`.
6. Sentry: wrap in `startSpan({ name: "shop.seller_submission.submit" })`. Never put the seller's email, name or phone into Sentry attributes/tags. Only `submissionId`, photo count and condition.
7. PostHog: the site has no server-side PostHog (`posthog-js` only), so `seller_submission_created { photo_count, condition }` is captured client-side in `SellerForm` after `{ ok: true }`, the same way `wishlist_item_added` is. No PII in properties.

### 8. Action unit tests: `src/app/(main)/shop/sell/__tests__/actions.unit.test.ts`

Mock `@/lib/shared/supabase` (`createAdminClient` → `{ from, storage: { from: () => ({ createSignedUploadUrl, list, createSignedUrls }) } }`), `@sentry/nextjs` (as in the wishlist test) and `@/lib/resend`.

- `prepareSellerPhotoUploads` with 3 valid photos: calls `createSignedUploadUrl` exactly 3 times. Every path matches `^<submissionId>/[0-2]\.(jpg|png|webp)$`, and the extension follows the mime. No path starts with `seller-submissions/`. The returned uploads mirror the mocks.
- Invalid text fields (e.g. missing title) with valid photos: `createAdminClient` not called, zero URLs.
- 7 photos → invalid, zero URLs. A 6 MB photo → invalid, zero URLs.
- Honeypot → `{ kind: "done" }`, `createAdminClient` not called.
- `submitSellerSubmission` with paths under its own id that the mocked `list` returns: inserts one row with the expected snake_case columns (`asking_price_cents` integer, `id = submissionId`, `status` not sent) and sends the email with the signed URLs.
- **A path outside its own prefix** (another uuid, or `seller-submissions/<id>/0.jpg`): `{ ok: false }`, `list` and `insert` not called.
- A path that `list` does not return: `{ ok: false }`, no insert.
- A listed object with `metadata.size` over 5 MB: `{ ok: false }`, no insert.
- The email function rejects: result is `{ ok: true }`, `captureException` called once, the insert happened.
- `23505` on insert: `{ ok: true }`, email not sent.
- Honeypot on submit: `{ ok: true }`, no client.
- Result shape: `Object.keys` of each result only contains the declared keys (nothing about other submissions returned).
- **Negative check (manual, recorded in the PR):** temporarily remove the `isOwnPhotoPath` prefix check in `submitSellerSubmission`, run `yarn workspace website test:unit`, confirm the "path outside own prefix" test fails, then restore the check. State in the PR that this was tried and reverted.

### 9. Client upload helper: `src/app/(main)/shop/sell/ui/upload-photo.ts`

- `uploadPhoto(signedUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void>` using `XMLHttpRequest` `PUT`, `Content-Type: file.type`, `xhr.upload.onprogress` for progress. Resolves on 2xx, rejects otherwise. `fetch` has no upload progress, which is why this is XHR.
- The browser does not need `@supabase/supabase-js` or the anon key: the signed URL carries the token.

### 10. Form island: `src/app/(main)/shop/sell/ui/SellerForm.tsx`

`"use client"`, `useActionState(runSubmit, initialSellerFormState)`, no Radix.

- Labelled inputs with stable ids (`seller-name-label`, `seller-email-label`, … like `BookingEngineExpanded`): name, email, phone (optional), title, maker or brand (optional), materials, dimensions (optional, placeholder "e.g. 40 × 30 × 90 cm"), condition (`<select>` with the four labels), asking price in euros (`inputMode="decimal"`, prefixed "€"), description (`<textarea>`, helper "Story, provenance, anything the owner should know"). Each has `aria-invalid` + `aria-describedby` to its error span. Each is re-keyed by `state.attempt` with `defaultValue` from `state.values`.
- **Photos**: `<input type="file" multiple accept="image/jpeg,image/png,image/webp">` with **no `name`**, so files are not sent in `FormData` (they must never reach a Server Action). The selected `File[]` is kept in `useState`, because React resets the form, including file inputs, when an action starts. `onChange` appends the chosen files (capped at 6), runs `checkPhotoFile` on each and shows the per-file error immediately ("<name>: too large (max 5 MB)"). Invalid files are listed with their error and not uploaded. Each listed file has a "Remove" button and a progress indicator (`<progress>` with an accessible label) during upload.
- Honeypot `website` input off-screen with `aria-hidden`, `tabIndex={-1}`, as in `WishlistForm`.
- Consent checkbox with `SELLER_CONTACT_CONSENT_COPY`, controlled. Submit button "Send to the owner" is disabled until consent is ticked, while pending, or while any selected photo has an error.
- `runSubmit(prev, formData)`:
  1. `fields = sellerFieldsFromFormData(formData)`.
  2. Client pre-check: 1–6 photos, all passing `checkPhotoFile`. Otherwise return the state with `errors.photos`, no server call.
  3. `prepareSellerPhotoUploads(fields, files.map(({ type, size }) => ({ type, size })))`. `invalid` → return errors. `done` → return the success state.
  4. Upload every file with `uploadPhoto` (in parallel, updating per-file progress state). Any failure → `SELLER_UPLOAD_ERROR_COPY`, and keep the files so the seller can retry (a retry calls `prepare` again and gets a fresh `submissionId`).
  5. `submitSellerSubmission(fields, submissionId, uploads.map((u) => u.path))`. On `ok`: `posthog.capture("seller_submission_created", { photo_count, condition })` and return `ok: true`.
- On `state.ok` render only `<p role="status">{sellerSuccessCopy(state.values.email)}</p>`. No reference number, no status link.
- Server errors map to the matching field. `generalError` shows in a `role="alert"` block.
- Use the `no-unnecessary-effects` approach: no `useEffect`. Progress is set from XHR callbacks, and validation runs in `onChange`.

### 11. Page: `src/app/(main)/shop/sell/page.tsx`

- Server component, `export const metadata` (title "Offer a piece - issebya.homes", a description, `alternates.canonical: ${SITE_URL}/shop/sell`). Reads nothing from the request, so it prerenders (same comment as `shop/page.tsx`).
- A short intro paragraph in brand voice (see branding guide, no em-dashes), a `Breadcrumb` back to `/shop` if the shared `src/app/ui/Breadcrumb.tsx` fits (as on `/shop/[slug]`), then `<SellerForm />`.

### 12. Link from `/shop` and sitemap

- `src/app/(main)/shop/page.tsx`: below the products section add one line, `<p>` with `SELL_LINK_COPY` where "Offer it here" is a `next/link` to `/shop/sell`. No other change to the grid.
- `src/app/sitemap.ts`: add `{ url: `${SITE_URL}/shop/sell`, changeFrequency: "yearly", priority: 0.3 }` to `staticRoutes`.

### 13. CSP: allow the browser upload

- `src/proxy.ts`: derive `supabaseOrigin` from `process.env.SUPABASE_URL` (`new URL(...).origin`, guarded with a try/catch or an `undefined` fallback) and append it to `connect-src`, the same conditional-spread way as `posthogHost`. Without this, the local and E2E `PUT` to `http://127.0.0.1:54321` is blocked by CSP. In prod, `https://*.supabase.co` already covers it, and adding the explicit origin is harmless.

### 14. E2E Resend mock

- `src/instrumentation.ts`: add `E2E_MOCK_RESEND` next to `E2E_MOCK_STRIPE`. When `"true"`, register `http.post("https://api.resend.com/emails", () => HttpResponse.json({ id: "e2e-email" }))`. Update the early return and the docblock. The Resend SDK uses global `fetch`, so the existing `FetchInterceptor` catches it (confirm when implementing).
- `playwright.config.ts`: add `E2E_MOCK_RESEND: "true"` to `webServer.env`, with a one-line comment (the spec must not email the owner on every run).

### 15. Browser test: `src/app/(main)/shop/sell/ui/SellerForm.browser.test.tsx`

Mock `../actions`, `./upload-photo`, `posthog-js` and `@sentry/nextjs` as in `WishlistForm.browser.test.tsx`. Create files in-test with `new File([new Uint8Array(size)], "x.jpg", { type })`, set through `userEvent.upload` on the file input (found by its label "Photos").

- Submit is disabled until the consent box is ticked.
- Choosing a 6 MB JPEG shows the size error right away. Neither `prepareSellerPhotoUploads` nor `uploadPhoto` is called.
- Choosing a GIF shows the type error.
- Happy path: fill fields, add 2 valid photos, tick consent, submit. Mocked `prepare` returns 2 uploads, `uploadPhoto` resolves, and `submit` resolves `{ ok: true }`. The success copy `sellerSuccessCopy("seller@example.com")` is visible. `uploadPhoto` was called twice with the minted URLs. `submitSellerSubmission` got the minted paths. PostHog got `seller_submission_created` with `{ photo_count: 2, condition }`.
- A field error from `prepare` (`{ kind: "invalid", errors: { title: … } }`) shows under the title input, and typed values survive (re-keyed inputs).
- If Vite reports a newly optimised dependency, add it to `optimizeDeps.include` in `vitest.config.ts`.

### 16. Playwright spec: extend `apps/website/e2e/shop.integration.spec.ts`

Model it on `booking-flow.integration.spec.ts` and the existing `Wishlist` block. New `test.describe("Seller submission")`:

- `beforeEach`: unique `email = e2e-seller-${randomUUID()}@example.com`.
- `afterEach`: with `createAdminClient()`, select the rows by `seller_email`, `storage.from("seller-submissions").remove(row.photo_paths)`, then delete the rows.
- "the shop links to the sell page": `/shop` → click "Offer it here" → URL `/shop/sell`, form heading visible.
- "a seller submits a piece with two photos": fill every field, `setInputFiles` on the photo input with two small in-memory PNG/JPEG buffers (`{ name, mimeType, buffer }`), tick consent, submit. Expect the success copy with the email. Then via the admin client: exactly one row for that email, `status = 'new'`, `asking_price_cents` as entered (e.g. `"120,50"` → 12050), `photo_paths` has 2 entries both under `<row.id>/`, and `storage.from(bucket).list(row.id)` returns 2 objects. This proves the real signed-URL upload, the CSP change, the existence check and the insert end to end.
- "anon cannot read seller submissions": `createClient().from("shop_seller_submissions").select("*")` → `error.code === "42501"`.
- Optional: "sitemap lists /shop/sell". Extend the existing sitemap test instead with one extra `toContain`.

### 17. Documentation touch points

- Create `apps/website/app_docs/feature-7d77143c-shop-seller-submission-form.md` in the `/document` phase and add its `conditional-docs.md` entry (conditions: changing the sell form, the `shop_seller_submissions` table or the `seller-submissions` bucket; adding any other Storage upload; a signed upload blocked by CSP).
- `apps/website/README.md`: no env var changes. Mention `/shop/sell` only if the README lists routes.

### 18. Run the validation commands

Run every command in `Validation Commands`, fix anything red, and confirm in the build output that `/shop` and `/shop/sell` are listed as prerendered (static).

## Testing Strategy

### Unit Tests

- `src/lib/shop/__tests__/seller-submission.unit.test.ts`: schemas, `eurosToCents`, photo limits, consent, honeypot, path helpers.
- `src/app/(main)/shop/sell/__tests__/actions.unit.test.ts`: URL minting count and server-chosen paths, no minting on invalid text, prefix check, existence/metadata check, insert shape, email failure tolerance, duplicate submit idempotency, honeypot, result shape.
- `src/lib/__tests__/resend.unit.test.ts`: the plain-text owner email body and error propagation.
- Existing `wishlist.unit.test.ts` and wishlist action tests cover the `emailSchema` extraction without changes.

### Test Coverage

- `seller-submission.unit.test.ts` (`*.unit.test.ts`): catches a schema that lets 0 or 7 photos, a 6 MB photo, a non-image mime, a mis-entered price or a missing consent through, or a path helper that prefixes the bucket name. Nothing covers these rules today.
- `sell/__tests__/actions.unit.test.ts` (`*.unit.test.ts`): catches minting URLs for invalid input or more than N, client-chosen or foreign-prefix paths being accepted, rows recorded for photos that were never uploaded, and a failed email failing the submission. It fails without the actions. With the prefix check removed, the "path outside own prefix" test fails (negative check, tried and reverted).
- `resend.unit.test.ts` (`*.unit.test.ts`): catches a notification email missing a field, a photo link, or the Studio line, and a swallowed Resend error.
- `SellerForm.browser.test.tsx` (`*.browser.test.tsx`): catches submit being enabled before consent, an oversize file only being rejected after an upload attempt, and the success copy not showing after the actions resolve. It gates on push and in CI.
- `e2e/shop.integration.spec.ts` "Seller submission" (`apps/website/e2e/*.spec.ts`): the only layer that proves the real browser → signed URL → Storage `PUT` → existence check → row insert chain against the local database and bucket, including the CSP `connect-src` change and the `42501` for anon. It runs in the ADW test phase, not in CI.

### Edge Cases

- Exactly 6 photos (allowed) and a 7th chosen (blocked client-side, and rejected server-side if forced).
- A photo exactly 5 MB (allowed) and 5 MB + 1 byte (rejected).
- A browser that reports an empty or wrong `file.type`: rejected client-side. If forced, the bucket's `allowed_mime_types` rejects the `PUT`, and finalize's metadata check rejects the row.
- Price `"0"` (allowed, a free piece), `"120,50"` (comma decimal), `"12.345"`, `"€120"` (rejected. Strip nothing: the "€" is a visual prefix outside the input).
- Optional fields left empty stored as `null`.
- Double-click / retried finalize with the same `submissionId`: one row, one email (`23505` → success).
- Upload fails mid-way: error shown, files kept, retry mints a fresh `submissionId`. The orphaned objects from the first attempt stay in the bucket (see Notes).
- `ADMIN_NOTIFICATION_EMAIL` unset: the submission still succeeds, no email.
- Resend down: the row is saved, Sentry gets the error, the seller still sees success.
- Honeypot filled at prepare or at submit: success screen, no URLs, no row.
- Tampered finalize: a path under another uuid, a `seller-submissions/` prefixed path, `..` segments, a duplicate path. All rejected.
- React form reset after an error: text inputs are re-seeded from `state.values`, and photos persist because they live in state.

## Acceptance Criteria

- `/shop` ends with "Have a piece that belongs in the house? Offer it here." linking to `/shop/sell`. Nothing else on `/shop` changed.
- `/shop/sell` is prerendered (static), has metadata, and is in `sitemap.xml`.
- All fields are validated server-side with per-field errors, within the limits in the issue. The price is entered in euros and stored as integer cents, converted once.
- Photos: 1–6, JPEG/PNG/WebP, ≤ 5 MB each, checked on the client before any upload and on the server against the Storage metadata.
- Uploads go browser → Storage via server-minted signed upload URLs. Paths are `<submissionId>/<index>.<ext>`, never prefixed with the bucket name. At most 6 URLs per request, and only after the text fields pass validation.
- `submitSellerSubmission` refuses paths outside its own `submissionId` prefix and paths that do not exist in the bucket.
- The migration creates `public.shop_seller_submissions` (all columns and checks from the issue, `updated_at` trigger, RLS on, anon/authenticated revoked, no policies) and the private `seller-submissions` bucket (`public = false`, 5 MB, 3 image mimes). As `anon`, a select on the table fails with `42501`.
- The owner gets a plain-text email with every field, one 7-day signed download URL per photo, and "Review in Supabase Studio → shop_seller_submissions". A failed email is logged and reported to Sentry and does not fail the submission.
- The success screen reads "Thank you. Sveta will look at your piece and get back to you at <email>." No reference number.
- No response ever contains data about other submissions.
- The honeypot yields the success screen with no URLs minted and no row.
- PostHog `seller_submission_created { photo_count, condition }` fires on success, with no PII.
- No change to `products.ts`, `schema.ts`, or the `/shop` grid.
- All validation commands are green. The negative prefix-check test was run and reverted.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn supabase migration up` - (repo root) applies the new migration to the shared local database without a reset
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the feature works with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and the route table shows `/shop` and `/shop/sell` as static (○)

## Notes

- **No new dependencies.** `@supabase/supabase-js` 2.110.7 already has `createSignedUploadUrl`, `list` and `createSignedUrls`. Uploads use plain `XMLHttpRequest`.
- **Signed upload URL lifetime.** Supabase's `createSignedUploadUrl` has a fixed 2-hour validity, which this SDK version cannot change. It is short enough for a single form session and the path is server-chosen, so it meets the "short-lived" intent. Mention it in the feature doc.
- **Orphaned uploads.** Photos uploaded by an abandoned or failed attempt stay in the bucket with no row. That is acceptable for this issue: they are private, and the owner can delete them in Studio. A cleanup job (objects older than a day with no matching row) is a follow-up, see the deferred cron scheduler.
- **`submissionId` is not signed.** Finalize trusts only what it can verify: the uuid shape, the prefix, and that the objects exist. Guessing another seller's uuid gives nothing: an already-finalized id hits `23505`, and an unfinalized one only finalizes photos that seller uploaded, with the attacker's own text. An HMAC over the id is a cheap later hardening if spam appears.
- **Production/preview.** The migration reaches prod only through the `master` migration gate (`app_docs/database/production-migrations.md`). Storage buckets live in the database (`storage.buckets`), so the same `supabase db push` creates the bucket. If the PR preview points at the prod database, the bucket and table will not exist there until the migration is applied: coordinate that first and say so in the PR. The manual preview check (2 photos, owner email with 2 working links, one Studio row `status = new`, row pasted with email redacted) is a PR step for a human, not part of the automated pipeline.
- **CSP.** The `connect-src` change is needed for local and E2E. Prod was already covered by `https://*.supabase.co`.
- **PostHog server-side.** The website has no `posthog-node`, so the event is captured client-side after a confirmed `ok`, matching the wishlist feature. Adding `posthog-node` just for this would be a new dependency for no gain.
- Out of scope, per the issue: seller accounts, edit/withdraw, status emails to the seller, admin UI, moving accepted items into the registry, CAPTCHA/Turnstile, rate limiting beyond the honeypot.
