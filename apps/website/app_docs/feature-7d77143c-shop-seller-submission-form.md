# Shop Seller Submission Form (`/shop/sell`)

**ADW ID:** 7d77143c
**Date:** 2026-09-24, reworked as a wizard 2026-10-01 (issue #205)
**Specification:** specs/issue-139-adw-7d77143c-sdlc_planner-shop-seller-submission-form.md

## Overview

Outside sellers can offer a piece for the shop through one page, `/shop/sell`, in three steps: who they are and what the piece is, then the photos, then a summary and Send. Each step is one dispatch on a single `useActionState` reducer, and each depends on what the step before it returned: step one creates a `draft` row and returns its id, step two uploads the photos under that id, and step three flips the row to `submitted`, which is the only moment the owner is emailed. Photos go from the browser straight into a private Supabase Storage bucket through server-minted signed upload URLs (Vercel caps request bodies at 4.5 MB, so a Server Action can't carry them). The owner reviews submissions in Supabase Studio and emails the seller.

This is the sequential `useActionState` pattern from `apps/patterns/content/use-action-state.mdx`: the state object carries the submission id from call to call, React runs the reducer one dispatch at a time, so no step can start before the previous one has returned and a second click on Next sees the id the first one created.

## What Was Built

- Static `/shop/sell` page with a `"use client"` `SellerForm` island: three step components over one `useActionState` reducer, per-file validation, per-photo upload progress, honeypot, consent gate, a read-only review step with thumbnails
- Three Server Actions, one per step: `createSellerDraft`, `prepareSellerPhotoUploads`, `submitSellerSubmission`, plus `sellerDetailsStep`, the details step in reducer shape `(prevState, formData)` so step one is a real POST form
- `status` on `shop_seller_submissions` now starts at `draft` and the wizard flips it to `submitted`; the owner's review states are unchanged
- Migration creating the `shop_seller_submissions` table and the private `seller-submissions` bucket, and a second one for the draft state
- Owner notification email (`sendSellerSubmissionNotificationEmail`) via Resend, sent only on Send
- Shared `emailSchema` extracted from the wishlist module
- "Offer it here." link at the bottom of `/shop`, and `/shop/sell` in the sitemap
- CSP `connect-src` allowance for the configured Supabase origin
- `E2E_MOCK_RESEND` MSW mock so Playwright runs never email the owner

## Technical Implementation

### Files Modified

- `supabase/migrations/20260925120000_create_shop_seller_submissions.sql`: table (RLS on, zero policies, `anon`/`authenticated` revoked, `updated_at` trigger, `(status, created_at desc)` index) and the bucket (private, 5 MB, JPEG/PNG/WebP only, no `storage.objects` policies)
- `supabase/migrations/20261001120000_add_draft_status_to_shop_seller_submissions.sql`: adds `draft` to `status`, renames `new` to `submitted` (existing rows included), default `submitted`, and lets a draft hold an empty `photo_paths`. Idempotent: constraints are dropped by name before they are re-added
- `apps/website/src/lib/shop/seller-submission.ts`: pure module shared by client and server. Limits, bucket name, copy, Zod schemas (`sellerFieldsSchema`, `sellerPhotosMetaSchema`, `sellerSubmissionSchema`), `eurosToCents`/`formatCents`, `photoObjectPath`/`isOwnPhotoPath`, the result types per step, `SellerWizardState` and `initialSellerWizardState`, `sellerFieldsFromFormData`
- `apps/website/src/app/(main)/shop/sell/actions.ts`: the Server Actions
- `apps/website/src/app/(main)/shop/sell/page.tsx`: static server page and metadata
- `apps/website/src/app/(main)/shop/sell/ui/SellerForm.tsx`: the wizard. `runWizard` is the reducer; `DetailsStep`, `PhotosStep` and `ReviewStep` render one step each; captures PostHog `seller_submission_created` (photo count and condition only) on Send
- `apps/website/src/app/(main)/shop/sell/ui/upload-photo.ts`: XHR `PUT` wrapper (XHR because only it reports upload progress; kept separate so the browser test can mock it)
- `apps/website/src/lib/resend.ts`: `sendSellerSubmissionNotificationEmail`, plain text, `replyTo` the seller, throws on Resend's `{ error }`
- `apps/website/src/lib/shared/schemas/email.ts`: shared `emailSchema` (trim, lowercase, max 254, `z.email`), now also used by `wishlist.ts`
- `apps/website/src/proxy.ts`: adds the origin of `SUPABASE_URL` to `connect-src` (local Storage is `http://127.0.0.1:54321`, not `*.supabase.co`)
- `apps/website/src/instrumentation.ts`, `apps/website/playwright.config.ts`: `E2E_MOCK_RESEND` handler for `POST https://api.resend.com/emails`
- `apps/website/src/app/(main)/shop/page.tsx`, `apps/website/src/app/sitemap.ts`: sell link and sitemap entry
- `apps/website/vitest.config.ts`: `resend` added to browser `optimizeDeps.include`

### The wizard

One `useActionState` holds `{ step, submissionId, fields, photoPaths, errors, generalError, attempt }` (`SellerWizardState`). The reducer, `runWizard`, takes a typed payload:

| Payload                           | What runs                                                                                                                                             | Next state                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `{ type: "DETAILS", formData }`   | `sellerDetailsStep(prevState, formData)`, which calls `createSellerDraft(fields, prevState.submissionId)`. The step one `<form action>` dispatches this with its FormData. | `step: "photos"`, `submissionId` set; or field errors on `details` |
| `{ type: "PHOTOS", files }`       | Client checks (count, type, size), `prepareSellerPhotoUploads(submissionId, meta)`, then one XHR `PUT` per file with progress                        | `step: "review"`, `photoPaths` set                              |
| `{ type: "SEND" }`                | `submitSellerSubmission(submissionId, photoPaths)`                                                                                                   | `step: "done"`                                                  |
| `{ type: "BACK" }`                | Nothing on the server                                                                                                                                 | The previous step, errors cleared                               |

Manual dispatches (Back) are wrapped in `startTransition`; the step forms pass a function to `<form action>`, which React runs inside a Transition for you. Every branch catches and returns its failure as `generalError`, never throws: a thrown reducer would drop every dispatch queued behind it.

The chosen `File` objects live in component state next to the hook, not in the wizard state: they must never reach a Server Function, and the wizard state has to be plain data because it is bound into the step one form. Their object URLs are the thumbnails on the review step. Going Back keeps both the typed fields (seeded from `state.fields`) and the chosen files.

**Progressive enhancement.** While `SellerForm` renders on the server, the hook is given `sellerDetailsStep` itself. React only renders a `<form action>` as a real POST when the reducer is a Server Function reference (it needs the function's `$$FORM_ACTION`), so this is what makes step one work before hydration and with JavaScript off: the browser posts to `sellerDetailsStep`, the draft is created, and the server answers with the page already on step two. In the browser the hook is given `runWizard`, which calls that same Server Function for DETAILS and adds the branches only a browser can run. Steps two and three need JavaScript (the uploads go from the browser to Storage); step two says so in a `<noscript>`. The consent gate on Next is applied only once the script runs (`useSyncExternalStore` hydration flag), or the server-rendered button would be disabled forever without JavaScript.

### Key Changes

- **A draft first.** `createSellerDraft` validates the text fields with `sellerFieldsSchema` and inserts the row with `status = 'draft'` and `photo_paths = '{}'`, under a `crypto.randomUUID()` it picks. Given an existing id it updates that draft instead; a second click on Next arrives after the first returned, sees the id in `prevState`, and updates. An id with no draft row behind it (already sent, or not ours) starts a fresh draft rather than stranding the seller.
- **Server picks every path.** `prepareSellerPhotoUploads` checks the photo metadata, confirms the row is still a `draft` of ours, and only then mints one `createSignedUploadUrl` per photo at `<submissionId>/<index>.<ext>`. The bucket name is never part of the path. It never mints more than 6.
- **Nothing the browser claims is trusted.** `submitSellerSubmission` rejects any path that fails `isOwnPhotoPath` (exact `<submissionId>/<0-5>.<jpg|png|webp>`), then lists the bucket prefix and checks that each object exists with an allowed `mimetype` and `size` of 5 MB or less. Only then does it update the row: `photo_paths` and `status = 'submitted'`, filtered on `status = 'draft'`.
- **Send is idempotent.** Only a row still in `draft` flips. A second Send for the same id (a retry, a double click that got through) updates nothing; the action sees the row is already past `draft` and answers `ok: true` without a second email. This replaces the earlier `23505` duplicate-insert path.
- **Email is best effort.** The row is flipped first. Signing the download URLs and sending the email run in a `try` whose failure is logged and sent to Sentry, but still returns `ok: true`.
- **Honeypot** (DOM field `website`) is checked in `createSellerDraft`, before any other field. It answers `{ kind: "done" }`, which the reducer turns into the thank-you step, and nothing is written. Only the submission id, photo count and condition reach Sentry, never seller PII.

## How to Use

1. On `/shop`, follow "Have a piece that belongs in the house? Offer it here." to `/shop/sell`.
2. Step one: fill in name, email (phone optional), title, materials, condition, asking price in euros (`120`, `120.50` or `120,50`), a description of at least 20 characters, tick the contact consent and press Next. The draft now exists.
3. Step two: add 1 to 6 JPEG/PNG/WebP photos, each 5 MB or less. Bad files are flagged as soon as they are chosen. Next uploads them with a progress bar each.
4. Step three: check the summary and the thumbnails, then Send to the owner. Back on any step keeps what was entered.
5. Owner: open Supabase Studio, `shop_seller_submissions`, and look at `status = 'submitted'`. Drafts (`status = 'draft'`) are abandoned step-one forms and can be ignored or deleted. Set `status` (`reviewing`, `accepted`, `rejected`) and `owner_notes`. Photos are in the `seller-submissions` bucket. Accepted pieces are added to `src/lib/shop/products.ts` by hand.

## Configuration

- No new env vars. Uses the existing `SUPABASE_URL` / service-role key, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `ADMIN_NOTIFICATION_EMAIL`. If `ADMIN_NOTIFICATION_EMAIL` is unset, no email is sent. If `RESEND_FROM_EMAIL` is missing, the send throws, which gets reported and swallowed.
- Apply the migrations locally with `yarn supabase migration up` from the repo root. Never `db reset` the shared instance. If the CLI refuses with `Remote migration versions not found in local migrations directory`, another worktree applied a migration this branch does not have; a temporary, uncommitted file with that version prefix in `supabase/migrations/` lets the CLI continue.
- `supabase/config.toml` already has `[storage] enabled = true`.

## Testing

- Unit: `src/lib/shop/__tests__/seller-submission.unit.test.ts` (schemas, price parsing, path checks), `src/app/(main)/shop/sell/__tests__/actions.unit.test.ts` (draft insert and update, the draft check before minting, the `draft` to `submitted` flip, honeypot, path refusal, listing checks, idempotent Send, email failure, `sellerDetailsStep` as a reducer), `src/lib/__tests__/resend.unit.test.ts`.
- Browser: `src/app/(main)/shop/sell/ui/SellerForm.browser.test.tsx` (mocks `../actions`, `upload-photo` and `next/image`): the three-step flow, Back keeping values and the draft id, a double click on Next creating one draft, a thrown step returned as state, server field errors.
- E2E (not gating): the `Seller submission` block in `e2e/shop.integration.spec.ts` covers the shop link, a real three-step submission against local Supabase (the `draft` row after step one, `submitted` after Send), and a check that anon cannot read the table. Resend is mocked.
- By hand, JavaScript off: fill step one and press Next. The page comes back on step two, and the row is in Studio as a `draft`.

## Notes

- A piece's submission never touches the static product registry.
- Abandoned drafts and orphaned photos (an upload that failed partway, a seller who closed the tab on step two) are not cleaned up yet. Resuming a draft from a link is out of scope.
- Preview deployments need the migrations applied to whatever database they point at, or the bucket, table and `draft` state won't exist. See `app_docs/database/production-migrations.md`.
