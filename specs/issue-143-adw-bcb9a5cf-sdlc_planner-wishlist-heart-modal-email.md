# Feature: Shop wishlist heart button, dismissible dialog, confirmation panel and guest email

## Metadata

issue_number: `143`
adw_id: `bcb9a5cf`
issue_json: `{"number":143,"title":"Shop wishlist: heart-icon button, dismissible modal, a real confirmation panel, and a confirmation email to the guest (follow-up to #138)"}`

## Feature Description

Follow-up to #138 / PR #140. The wishlist on `/shop/[slug]` currently renders an "Add to wishlist" text button that toggles an inline form under the price. After a successful save the only feedback is the line "Saved. We'll let you know about it." in plain body text directly above the product details, and the button looks unchanged, so the owner reads the result as "nothing happened".

This feature reworks the client island and adds one server-side side effect:

1. The trigger becomes an inline-SVG **heart icon button**: outline before, filled after a successful add in this page session (component state only, lost on reload by design).
2. The form moves into a native **`<dialog>` modal** opened with `showModal()`, dismissible via a Close button, `Escape`, and backdrop click, with focus moving in on open and back to the heart on close, and body scroll locked while open.
3. On success the dialog swaps the form for a **confirmation panel**: a bordered `bg-shop-card` box with `role="status"`, the filled heart, the product name as its heading, `WISHLIST_SUCCESS_COPY`, a "We've sent a note to <email>." line (only when a new item was created), and a Close button. Not a toast: no auto-dismiss, not `position: fixed`.
4. The Server Action sends a short plain-text **confirmation email** to the guest through Resend, only when the wish is new, after the DB writes succeed. A send failure is logged and reported to Sentry but never fails the action.

## User Story

As a guest browsing a product on the shop
I want to tap a heart, give my email once, and clearly see the piece is on my list (and get an email saying so)
So that I know my wish was saved and I have a record of it in my inbox

## Problem Statement

The current inline form gives no visible signal that anything happened: the success line is indistinguishable from body copy, the trigger does not change, and the guest gets nothing in their inbox. The owner's preview review concluded the feature looks broken.

## Solution Statement

Replace `WishlistForm.tsx` with `WishlistDialog.tsx`, a `"use client"` island made of a heart `<button>` plus a native `<dialog>` that hosts the existing form (unchanged fields, consent logic, honeypot, `localStorage` prefill) and, on success, a distinct confirmation panel. The heart's filled state and the dialog's open/close are component state and native dialog APIs only, driven from event handlers (no effects needed). Scroll lock is a one-line CSS rule (`body:has(dialog[open]) { overflow: hidden; }`) so no JS has to remember to undo it.

On the server, `addToWishlist` learns whether the item row was newly created (`created: boolean` in the returned state). The existing plain `insert` already distinguishes the two cases: no error means a new row, a `23505` unique violation means already wished. That is equivalent to the issue's `on conflict do nothing` + `.select("id").maybeSingle()` suggestion but keeps the existing, tested code path, so it is the chosen approach. When `created` is true the action calls a new `sendWishlistConfirmationEmail` in `src/lib/resend.ts` inside `try/catch`, mirroring the seller-submission action's `console.error` + `captureException` pattern. All new copy lives as constants in `src/lib/shop/wishlist.ts`.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook gates).
- `apps/website/AGENTS.md` - read `node_modules/next/dist/docs/` before Next work; no Radix; which test layers gate (browser tests gate on push/CI, e2e is manual + ADW test phase).
- `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `.../server-actions.md` - Server Action / form guidance to re-check before touching the action and `useActionState` wiring.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md` - the #138 design: consent-first writes, honeypot, prerender-safe `localStorage` prefill, nothing leaks to the browser. All of that must be preserved.
- `apps/website/app_docs/client-form-guide.md`, `apps/website/app_docs/form-re-render-strategy.md` - `useActionState` conventions and form reset behaviour.
- `apps/website/app_docs/component-patterns-guide.md` - component structure; the heart SVG is rendered in two places (button and panel), so it is a small shared component.
- `apps/website/app_docs/branding-guidelines.md` - house voice for the new copy (no bold, no em dashes, no emojis).
- `apps/website/app_docs/environment-setup.md` - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md`, `apps/website/app_docs/testing/e2e_example.md` - test formats.
- `apps/website/app_docs/feature-7d77143c-shop-seller-submission-form.md` - the most recent Resend plain-text email + non-fatal send pattern in this workspace.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.tsx` - current island; renamed/rewritten to `WishlistDialog.tsx`.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.browser.test.tsx` - current browser tests; renamed to `WishlistDialog.browser.test.tsx` and extended.
- `apps/website/src/app/(main)/shop/[slug]/actions.ts` - `addToWishlist`; gains `created` and the email send.
- `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` - action tests; gains email cases and an updated state-shape assertion.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` - renders the island next to the price; import switches to `WishlistDialog` and it must stay prerendered.
- `apps/website/src/app/(main)/shop/sell/actions.ts` - reference for the `try { send } catch { console.error; captureException }` pattern (lines ~263-282).
- `apps/website/src/lib/shop/wishlist.ts` - copy constants, `WishlistFormState`, `initialWishlistState`; gains `created`, `WISHLIST_EMAIL_SENT_COPY`, email strings and a pure text builder.
- `apps/website/src/lib/shop/__tests__/wishlist.unit.test.ts` - pure-logic tests; gains tests for the new pure helpers.
- `apps/website/src/lib/shop/products.ts` - `getProductBySlug` for the product name in the email and panel.
- `apps/website/src/lib/site.ts` - `SITE_URL` for the product link in the email.
- `apps/website/src/lib/resend.ts` - gains `sendWishlistConfirmationEmail`.
- `apps/website/src/lib/__tests__/resend.unit.test.ts` - existing Resend-mocked unit tests; gains a `describe` for the new function.
- `apps/website/src/app/globals.css` - `--color-shop-card` token already exists; gains the `body:has(dialog[open])` scroll-lock rule.
- `apps/website/src/instrumentation.ts`, `apps/website/playwright.config.ts` - `E2E_MOCK_RESEND=true` is already set for the Playwright server, so e2e runs will not send real guest emails. No change needed; just confirm.
- `apps/website/e2e/shop.integration.spec.ts` - `Wishlist` describe block; selectors updated to the heart + dialog + panel.
- `docs/conditional-docs.md` - update the `feature-972c79dc` entry conditions or add the new feature doc entry (done by the document phase).

### New Files

- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` - replaces `WishlistForm.tsx` (use `git mv` then rewrite so history follows).
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` - replaces `WishlistForm.browser.test.tsx` (`git mv` then extend).
- `apps/website/src/app/(main)/shop/[slug]/ui/HeartIcon.tsx` - tiny inline-SVG heart, `filled` prop, `currentColor`, `aria-hidden`.

## Implementation Plan

### Phase 1: Foundation

Extend the pure module `src/lib/shop/wishlist.ts`: add `created` to `WishlistFormState` and `initialWishlistState`, the `WISHLIST_EMAIL_SENT_COPY` constant plus a formatter, and the email subject/lines plus a pure `wishlistConfirmationEmailText` builder. Everything here stays node-pool testable. Add `sendWishlistConfirmationEmail` to `src/lib/resend.ts` using those constants.

### Phase 2: Core Implementation

Server: make `addToWishlist` return `created` on every path and send the email only on a new item, non-fatally. Client: build `HeartIcon` and `WishlistDialog` (heart trigger, native dialog, form, confirmation panel, analytics), and add the scroll-lock CSS rule.

### Phase 3: Integration

Swap `page.tsx` to render `WishlistDialog` in the same slot, delete the old component/test via rename, update the e2e spec, and confirm `/shop/[slug]` is still prerendered in the build output.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs this change touches

- Read `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `server-actions.md` (repo root `node_modules`), per `apps/website/AGENTS.md`.
- Read `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`, `client-form-guide.md`, `form-re-render-strategy.md`, `branding-guidelines.md`.

### 2. Extend `src/lib/shop/wishlist.ts` (pure copy and state)

- `WishlistFormState` gains `created: boolean` (docblock: true only when this submit inserted a new item row; the client shows the "sent a note" line only then). `initialWishlistState.created = false`.
- Keep `WISHLIST_SUCCESS_COPY` text unchanged.
- Add `export const WISHLIST_EMAIL_SENT_COPY = "We've sent a note to {email}.";` and `export function wishlistEmailSentCopy(email: string): string` that replaces `{email}`.
- Add `export const WISHLIST_DIALOG_HEADING = "Save to your wishlist";`.
- Add email constants:
  - `WISHLIST_EMAIL_SUBJECT = "Saved to your wishlist – issebya.homes"` (en dash, matching the existing booking subjects; not an em dash).
  - `WISHLIST_EMAIL_NEWS_LINE = "We'll write to you when there's news about it."`
  - `WISHLIST_EMAIL_STOP_LINE = "Reply to this email to stop these."`
- Add a pure builder `wishlistConfirmationEmailText({ productName, productUrl }: { productName: string; productUrl: string }): string` that joins with `\n`:
  ```
  <productName> is on your wishlist.
  <productUrl>

  <WISHLIST_EMAIL_NEWS_LINE>

  You asked us to: "<WISHLIST_OPT_IN_COPY>" <WISHLIST_EMAIL_STOP_LINE>
  ```
  No bold, no em dashes, no emojis. Keep the module importing only `zod`, the email schema and `products` (do not import `SITE_URL` here; the URL is passed in).

### 3. Unit tests for the new pure helpers

- In `src/lib/shop/__tests__/wishlist.unit.test.ts` add:
  - `wishlistEmailSentCopy("guest@example.com")` returns `"We've sent a note to guest@example.com."`.
  - `wishlistConfirmationEmailText` output contains the product name, the product URL on its own line, `WISHLIST_EMAIL_NEWS_LINE`, `WISHLIST_OPT_IN_COPY` and `WISHLIST_EMAIL_STOP_LINE`, and contains no `—` (em dash).
  - `initialWishlistState.created` is `false`.

### 4. Add `sendWishlistConfirmationEmail` to `src/lib/resend.ts`

- Signature: `sendWishlistConfirmationEmail({ email, productName, productSlug }: { email: string; productName: string; productSlug: string }): Promise<void>`.
- Same shape as `sendSellerSubmissionNotificationEmail`: `new Resend(process.env.RESEND_API_KEY)`, throw `Missing environment variable: RESEND_FROM_EMAIL` if unset, `text` only (no `react` template), and throw when Resend returns `{ error }` so the caller's Sentry report sees a failed send.
- `to: email`, `subject: WISHLIST_EMAIL_SUBJECT`, `text: wishlistConfirmationEmailText({ productName, productUrl: `${SITE_URL}/shop/${productSlug}` })`.
- If `process.env.ADMIN_NOTIFICATION_EMAIL` is set, pass it as `replyTo` so "reply to stop" lands in the owner's inbox; otherwise omit `replyTo` (replies go to `RESEND_FROM_EMAIL`).
- Docblock: plain text on purpose (HTML templates are out of scope), sent only for a new wish.

### 5. Unit tests for `sendWishlistConfirmationEmail`

- In `src/lib/__tests__/resend.unit.test.ts` add a `describe("sendWishlistConfirmationEmail")` reusing the existing `mockSend` Resend mock and `vi.stubEnv`:
  - builds `from` = `RESEND_FROM_EMAIL`, `to` = guest email, `subject` = `WISHLIST_EMAIL_SUBJECT`, and a `text` containing `https://issebya.com/shop/<slug>` (via `SITE_URL`) and the product name.
  - sets `replyTo` to `ADMIN_NOTIFICATION_EMAIL` when configured, and omits it when that env is empty.
  - throws when `RESEND_FROM_EMAIL` is missing (and `mockSend` not called).
  - throws when Resend returns `{ error }`.

### 6. Update `addToWishlist` in `src/app/(main)/shop/[slug]/actions.ts`

- Every return path includes `created`: validation errors, honeypot success, `failure` → `created: false`.
- After the item insert: `const created = itemError === null;` (a `23505` means already wished → `created: false`, still `ok: true`).
- If `created`, look up `getProductBySlug(productSlug)` (always defined here: the schema already refined the slug) and call `await sendWishlistConfirmationEmail({ email: parsed.data.email, productName: product.name, productSlug })` inside `try/catch`. In `catch`: `console.error("Wishlist confirmation email failed", error)` and `captureException(error, { tags: { "email.type": "wishlist_confirmation" } })`. Never send the email address to Sentry (only the slug is on the span). Do not change the return value on failure.
- Return `{ attempt, ok: true, errors: {}, generalError: "", email, created }`.
- Keep the honeypot path free of any email send.

### 7. Update action unit tests `__tests__/actions.unit.test.ts`

- `vi.mock("@/lib/resend", () => ({ sendWishlistConfirmationEmail: (...a) => mockSendWishlistEmail(...a) }))`; default `mockResolvedValue(undefined)` in `beforeEach`.
- New item → `created: true` and `mockSendWishlistEmail` called once with `{ email: "guest@example.com", productName: firstProduct.name, productSlug: firstProduct.slug }`, and called only after the item insert (`invocationCallOrder`).
- Already wished (`23505`) → `ok: true`, `created: false`, email not called.
- Email throws → `ok: true`, `created: true`, `captureException` called once with the `email.type` tag.
- Honeypot, validation failure, upsert failure, non-duplicate insert failure → email not called, `created: false`.
- Update "returns only the form state shape" to include `created`.

### 8. Create `ui/HeartIcon.tsx`

- `export function HeartIcon({ filled, className }: { filled: boolean; className?: string })` returning an inline 24×24 `<svg aria-hidden="true" focusable="false" data-filled={filled}>` with one heart `<path>` using `stroke="currentColor"` and `fill={filled ? "currentColor" : "none"}`. No icon library.

### 9. Replace `WishlistForm.tsx` with `WishlistDialog.tsx`

- `git mv "apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.tsx" ".../ui/WishlistDialog.tsx"`, then rewrite. Keep `readRemembered`, `rememberWishlistEmail`, the storage keys, the honeypot, the controlled consent checkbox, the disabled-until-ticked submit and the helper exactly as they are.
- Props: `{ productSlug: string; productName: string }`.
- Parent `WishlistDialog` state/refs:
  - `dialogRef = useRef<HTMLDialogElement>(null)`, `heartRef = useRef<HTMLButtonElement>(null)`.
  - `added` (boolean, component state only, never persisted), `remembered` (read in the click handler as today, never during render, so prerender/hydration stay intact), `sessionKey` (number, incremented on close so the form remounts fresh), `submittedRef` (whether this open session saved, for analytics).
- Heart `<button type="button" ref={heartRef}>`: `aria-label={added ? "Added to wishlist" : "Add to wishlist"}`, `aria-pressed={added ? true : undefined}`, `aria-haspopup="dialog"`, classes giving at least a 44×44 px hit area (`inline-flex items-center justify-center min-w-11 min-h-11 cursor-pointer`), `<HeartIcon filled={added} className="w-6 h-6" />`. `onClick`: `setRemembered(readRemembered())`, `submittedRef.current = false`, `dialogRef.current?.showModal()`, `posthog.capture("wishlist_form_opened", { product_slug })`.
- `<dialog ref={dialogRef} aria-labelledby={headingId} onClose={handleClose} onClick={handleBackdropClick} className="p-0 backdrop:bg-black/50 bg-shop-card text-foreground max-w-md w-[calc(100%-2rem)]">`:
  - `handleBackdropClick`: `if (event.target === event.currentTarget) dialogRef.current?.close();` — all content sits inside an inner `<div className="p-6 ...">` so only the backdrop area targets the dialog element itself.
  - `Escape` is native (fires `cancel` then `close`); no extra handler needed.
  - `handleClose` (fires for Close button, Escape and backdrop): `posthog.capture("wishlist_dialog_dismissed", { product_slug, had_submitted: submittedRef.current })`, `setSessionKey((k) => k + 1)` (resets form state, keeps `added`), `heartRef.current?.focus()` (explicit, not relying on browser focus restoration).
  - Inside: `<h2 id={headingId}>` "Save to your wishlist" (`WISHLIST_DIALOG_HEADING`), a Close button (`type="button"`, text "Close", `onClick={() => dialogRef.current?.close()}`), and `<WishlistFields key={sessionKey} ... onSaved={handleSaved} />`.
  - Render the fields only while open is not required: the form mounts inside the closed dialog but with `key` reset on close; seed it from `remembered`, which is updated before `showModal()`. (If the seed must be applied at mount, also bump `sessionKey` in the open handler instead of the close handler; pick one and keep a comment explaining it.)
  - Focus on open: `showModal()` focuses the first focusable element; put `autoFocus` on the email input so focus lands there rather than on Close.
- `handleSaved(next)`: `setAdded(true)`, `submittedRef.current = true`. (`rememberWishlistEmail` + `wishlist_item_added` capture stay in `runAddToWishlist` as today.)
- `WishlistFields` on `state.ok` renders the confirmation panel instead of the form:
  ```
  <div role="status" className="border border-black bg-shop-card p-4 flex flex-col gap-3">
    <HeartIcon filled className="w-6 h-6" />
    <h3>{productName}</h3>
    <p>{WISHLIST_SUCCESS_COPY}</p>
    {state.created && <p>{wishlistEmailSentCopy(state.email)}</p>}
    <button type="button" onClick={onClose}>Close</button>
  </div>
  ```
  Not fixed-positioned, no timers. Since the dialog already has a header Close, either keep both or make the panel's Close the only one in the success state; the issue requires a Close in the panel, so keep it (the header Close stays for the form state).
- Scroll lock: add to `apps/website/src/app/globals.css`: `body:has(dialog[open]) { overflow: hidden; }` with a one-line comment. No JS body-style mutation.
- No `localStorage` for the heart, no server read.

### 10. Wire the page

- `page.tsx`: import `WishlistDialog` and render `<WishlistDialog productSlug={product.slug} productName={name} />` in the same slot next to the price. Wrap price + heart in `<div className="flex items-center gap-3">` so the heart sits beside the price. No dynamic APIs added; the page must stay prerendered.
- `ProductCard` on `/shop` stays untouched.

### 11. Browser tests `WishlistDialog.browser.test.tsx`

- `git mv` the old test file to `WishlistDialog.browser.test.tsx`; keep the existing mocks (`../actions`, `posthog-js`, `@sentry/nextjs`) and add `created` to mocked results. Render `<WishlistDialog productSlug={SLUG} productName="Sample Product One" />`.
- Keep intent of existing tests (opt-in gating + helper, success remembers email, prefill from `localStorage`), updated to open via the heart.
- New tests:
  - Heart starts with `aria-label="Add to wishlist"`, no `aria-pressed` attribute, and the outline icon (`svg[data-filled="false"]`).
  - Clicking the heart opens `dialog[open]` labelled "Save to your wishlist" and captures `wishlist_form_opened`.
  - `Escape` closes the dialog (`dialog` no longer `open`), focus returns to the heart (`toHaveFocus`), and `wishlist_dialog_dismissed` is captured with `had_submitted: false`.
  - Clicking the Close button closes the dialog.
  - After a mocked success with `created: true`: an element with `role="status"` inside the dialog contains the product name, `WISHLIST_SUCCESS_COPY` and `"We've sent a note to guest@example.com."`; the heart has `aria-pressed="true"`, `aria-label="Added to wishlist"` and `svg[data-filled="true"]`; closing then captures `had_submitted: true`, and the heart stays filled.
  - After a mocked success with `created: false` (already wished): panel shown, email line absent.
  - After closing a success, reopening shows the form again (state reset) while the heart stays filled.
- **Negative check**: temporarily remove the `aria-pressed` prop from the heart, run `yarn workspace website vitest run --project browser WishlistDialog` and confirm the filled-heart test fails; revert and confirm it passes. Record in the PR that this was tried and reverted.

### 12. Update the e2e spec `e2e/shop.integration.spec.ts`

- Import `wishlistEmailSentCopy` alongside the existing constants.
- In "wishing the same product twice stores one item and one consent":
  - Click `getByRole("button", { name: "Add to wishlist" })`; assert `page.getByRole("dialog", { name: "Save to your wishlist" })` is visible; scope subsequent locators to that dialog.
  - Fill, check, submit as today; assert `dialog.getByRole("status")` contains `firstProduct.name`, `WISHLIST_SUCCESS_COPY` and `wishlistEmailSentCopy(email)`; assert the heart now has name "Added to wishlist" and `aria-pressed="true"`. Click Close, assert dialog hidden.
  - Reload: heart is "Add to wishlist" again with no `aria-pressed` (in-memory by design). Open, confirm prefilled email, check, submit; the panel shows `WISHLIST_SUCCESS_COPY` and does **not** show the email line (already wished).
  - Keep the DB assertions (one item, one consent) and the `afterEach` cleanup.
- Add a small test: open the dialog, press `Escape`, dialog hidden, the heart is focused.
- The Playwright server already runs with `E2E_MOCK_RESEND=true`, so no real guest email is sent; update the comment above the `Wishlist` block to say so.
- Keep "anon cannot read either wishlist table" unchanged.

### 13. Documentation touch

- Update the "Prerender-safe prefill" / UI description in `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md` only if the document phase does not; otherwise leave docs to `/document`, which will add an entry to `docs/conditional-docs.md`.

### 14. Run the Validation Commands

- Run every command below from the repo root and fix anything red.
- Confirm in the `build` output that `/shop/[slug]` is still listed as prerendered (● SSG), not dynamic.

## Testing Strategy

### Unit Tests

- `src/lib/shop/__tests__/wishlist.unit.test.ts`: `wishlistEmailSentCopy`, `wishlistConfirmationEmailText` (contents, no em dash), `initialWishlistState.created`.
- `src/lib/__tests__/resend.unit.test.ts`: `sendWishlistConfirmationEmail` builds `from`/`to`/`subject`/`text` with the product URL, `replyTo` behaviour, throws on missing `RESEND_FROM_EMAIL` and on Resend `{ error }`.
- `src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts`: new item sends once after the insert; already-wished does not send; email failure keeps `ok: true` and calls `captureException`; honeypot/validation/DB failure never send; `created` on every path; state shape includes `created`.

### Test Coverage

- `src/lib/__tests__/resend.unit.test.ts` (`*.unit.test.ts`): catches a wrong recipient, subject or missing product link in the guest email; nothing covers this function today.
- `src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` (`*.unit.test.ts`): catches resending on repeat clicks, a send failure breaking the save, or sending on the honeypot path.
- `src/lib/shop/__tests__/wishlist.unit.test.ts` (`*.unit.test.ts`): catches copy drift in the email-sent line and email body (house voice, consent sentence present).
- `src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` (`*.browser.test.tsx`): catches the dialog not opening modally, `Escape`/Close not closing or not returning focus, the heart not flipping to `aria-pressed="true"` + filled, the panel missing `role="status"`/product name, the email line shown for an already-wished item, and the dismissed analytics event. Gated on push and in CI.
- `apps/website/e2e/shop.integration.spec.ts` (`e2e/*.spec.ts`): proves the real journey against the shared DB: heart → dialog → panel with email line on first save, no email line on repeat, heart resets on reload, one item and one consent stored.

### Edge Cases

- Already-wished product: `ok: true`, `created: false`, no email, panel without the "sent a note" line.
- Resend failure or missing `RESEND_FROM_EMAIL`: wish saved, `ok: true`, `captureException` + `console.error`, panel still claims the note was sent (see Notes).
- Honeypot filled: silent success, `created: false`, no DB write, no email.
- Dismiss via each path (Close button, `Escape`, backdrop click) fires `onClose` once and returns focus to the heart.
- Clicking inside the dialog padding/content must not count as a backdrop click (content wrapped in an inner div; dialog has `p-0`).
- Reopen after success: form is fresh (new `key`), heart stays filled, prefill re-read from `localStorage`.
- Reload: heart empty again (intended).
- `localStorage` unavailable: dialog and save still work, only prefill is lost (unchanged behaviour).
- Validation error inside the dialog keeps the dialog open and shows errors as today.
- Page prerender and hydration: nothing reads `localStorage` or `document` during render.

## Acceptance Criteria

- Heart button next to the price: `aria-label="Add to wishlist"` and no `aria-pressed` before; `aria-label="Added to wishlist"` and `aria-pressed="true"` after a successful add; inline SVG outline vs filled using `currentColor`; hit area at least 44×44 px; no icon library added.
- The form lives in a native `<dialog>` opened with `showModal()`, labelled by the "Save to your wishlist" heading, closing on Close, `Escape` and backdrop click, focus moving in on open and back to the heart on close, body scroll locked while open. No dialog library.
- On success the dialog shows a bordered `bg-shop-card` panel with `role="status"`, filled heart, product name heading, `WISHLIST_SUCCESS_COPY`, "We've sent a note to <email>." only for a new item, and a Close button. It never auto-dismisses and is not fixed-positioned.
- `sendWishlistConfirmationEmail` sends plain text with subject `Saved to your wishlist – issebya.homes`, the product name, `${SITE_URL}/shop/${slug}`, the news sentence, `WISHLIST_OPT_IN_COPY` and "Reply to this email to stop these."; called only for a new item, after DB writes; failures are logged + `captureException`ed and never fail the action.
- `addToWishlist` returns `{ attempt, ok, errors, generalError, email, created }`.
- PostHog: `wishlist_form_opened` and `wishlist_item_added` unchanged; `wishlist_dialog_dismissed { product_slug, had_submitted }` added.
- `ProductCard` on `/shop` unchanged; `/shop/[slug]` still prerendered.
- All new copy in `src/lib/shop/wishlist.ts`, house voice, no em dashes, no bold, no emojis.
- Negative check performed: removing `aria-pressed` makes the filled-heart browser test fail; reverted.
- All validation commands green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (catches a leftover `WishlistForm.tsx` or unused copy constants)
- `yarn turbo run test --filter=./apps/website` - Unit and browser (chromium) tests pass, including the new resend, action, wishlist and `WishlistDialog` tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; confirm `/shop/[slug]` is still marked prerendered in the route table

## Notes

- No new dependencies. The dialog is the native `<dialog>` element; the heart is inline SVG.
- `created` is derived from the existing `insert` result (`itemError === null` → new row; `23505` → already wished) instead of switching to `upsert(..., { ignoreDuplicates: true }).select("id").maybeSingle()`. Both answer "was a row inserted"; the existing path is already tested and needs no change to the DB call shape.
- If the email send fails, the panel still says "We've sent a note to <email>." because `created` reflects the saved item, as the issue specifies. If this ever matters, add an `emailSent` flag to the state; out of scope here.
- `replyTo` is set to `ADMIN_NOTIFICATION_EMAIL` when configured so "reply to this email to stop these" reaches someone who can act on it. The actual opt-out is still manual in Supabase Studio; unsubscribe mechanics are out of scope.
- Playwright already runs with `E2E_MOCK_RESEND=true` (`playwright.config.ts`), so the e2e suite never emails the random `e2e-wishlist-*@example.com` addresses.
- Manual PR-preview check (owner): add a product, receive the email (paste subject and first lines with the address redacted in the PR), see the heart filled, reload and see it empty again.
- Out of scope: persisting heart state, HTML email templates, unsubscribe links, heart on the product grid, a wishlist page.
- Only `apps/website` is touched; no migration, no changes to `telegram-router`, `guest-communication-agent` or `packages/pricing`.
