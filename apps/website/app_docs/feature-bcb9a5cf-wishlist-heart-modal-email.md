# Shop Wishlist Heart, Dialog, Confirmation Panel and Guest Email

**ADW ID:** bcb9a5cf
**Date:** 2026-09-24
**Specification:** specs/issue-143-adw-bcb9a5cf-sdlc_planner-wishlist-heart-modal-email.md

## Overview

Follow-up to the wishlist opt-in (#138, `feature-972c79dc-shop-wishlist-email-optin.md`). The "Add to wishlist" text button and inline form on `/shop/[slug]` gave no visible sign that a save worked. The trigger is now a heart icon that opens a native modal dialog, a successful save shows a proper confirmation panel, and the guest gets a plain-text confirmation email the first time they wish for a piece.

## What Was Built

- Heart icon button next to the price: outline before, filled after a successful save in this page session (component state only, empty again after a reload by design)
- Native `<dialog>` modal hosting the existing form (same fields, consent logic, honeypot and `localStorage` prefill), dismissible by Close, `Escape` or backdrop click
- Confirmation panel inside the dialog on success: filled heart, product name, `WISHLIST_SUCCESS_COPY`, a "We've sent a note to <email>." line when the wish is new, and a Close button. Not a toast: no auto-dismiss, not fixed-position
- `created` flag on the Server Action's state, so the client and the email send both know whether this submit inserted a new wish
- Plain-text Resend confirmation email to the guest, sent only for a new wish and never fatal to the save
- Page scroll lock while any modal dialog is open, done in CSS

## Technical Implementation

### Files Modified

- `src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx`: renamed from `WishlistForm.tsx` and rewritten as heart button + `<dialog>` + form + confirmation panel; fires `wishlist_form_opened`, `wishlist_item_added` and the new `wishlist_dialog_dismissed` (with `had_submitted`) PostHog events
- `src/app/(main)/shop/[slug]/ui/HeartIcon.tsx` (new): inline SVG heart with a `filled` prop, `currentColor`, `aria-hidden`, and `data-filled` for tests
- `src/app/(main)/shop/[slug]/actions.ts`: `addToWishlist` returns `created` on every path and sends the confirmation email when `created` is true
- `src/app/(main)/shop/[slug]/page.tsx`: renders `WishlistDialog` beside the price and passes `productName`
- `src/lib/shop/wishlist.ts`: `created` in `WishlistFormState` / `initialWishlistState`; new `WISHLIST_DIALOG_HEADING`, `wishlistEmailSentCopy`, email subject/line constants and the pure `wishlistConfirmationEmailText` builder
- `src/lib/resend.ts`: new `sendWishlistConfirmationEmail`
- `src/app/globals.css`: `body:has(dialog[open]) { overflow: hidden; }`
- Tests: `WishlistDialog.browser.test.tsx` (renamed from `WishlistForm.browser.test.tsx` and extended), `actions.unit.test.ts`, `resend.unit.test.ts`, `wishlist.unit.test.ts`, `e2e/shop.integration.spec.ts`

### Key Changes

- **New vs already wished.** The existing plain insert into `shop_wishlist_items` already tells the two apart: no error means a new row, a `23505` unique violation means the guest had already wished for it. `created = itemError === null`. This was chosen over the issue's `on conflict do nothing` + `.select()` suggestion to keep the tested code path.
- **Non-fatal email.** The send runs after the DB writes, inside `try/catch`, and a failure is `console.error`ed and sent to Sentry with tag `email.type: wishlist_confirmation`, matching the seller-submission pattern. The action still returns `ok: true`. Repeat saves of the same piece never resend.
- **Email content.** Plain text, subject `Saved to your wishlist – issebya.homes` (en dash), body with the product name, `${SITE_URL}/shop/<slug>`, a news line, and the quoted opt-in copy with "Reply to this email to stop these." `replyTo` is `ADMIN_NOTIFICATION_EMAIL` when set, so a stop request reaches the owner.
- **Dialog behaviour without effects.** `showModal()` is called from the heart's click handler; the dialog's `onClose` handles every exit path (fires the dismissed event, resets `isOpen`, returns focus to the heart). The form only mounts while open, so each open starts fresh from the remembered email/consent, and a closed success resets to the form. The email input has `autoFocus` so focus lands there, not on Close. Backdrop clicks are detected by `event.target === event.currentTarget`, which works because the dialog has no padding and all content sits in an inner div.
- **Prerender-safe.** `localStorage` is still read only in the click handler, so `/shop/[slug]` stays static.

## How to Use

1. Open any product at `/shop/<slug>`.
2. Click the heart next to the price. The "Save to your wishlist" dialog opens with focus in the Email field (prefilled if you saved before on this browser).
3. Enter an email, tick the consent checkbox, click "Save to wishlist".
4. The dialog shows the confirmation panel and the heart fills. On a first-time wish the panel says a note was sent, and the email arrives.
5. Close with the Close button, `Escape`, or a click outside the dialog.

## Configuration

Uses existing Resend variables (see `environment-setup.md`):

- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (required; a missing `RESEND_FROM_EMAIL` throws, which is logged and reported but does not fail the save)
- `ADMIN_NOTIFICATION_EMAIL` (optional; used as `replyTo`)

The Playwright server runs with `E2E_MOCK_RESEND=true`, so e2e runs never email real guest addresses.

## Testing

- Unit: `yarn workspace website test` covers the pure copy/email builders, `sendWishlistConfirmationEmail` (mocked Resend), and the action's `created` flag and email cases, including that a send failure still returns `ok: true`.
- Browser: `WishlistDialog.browser.test.tsx` covers opening, dismissal paths, focus return, the confirmation panel and the heart's filled state.
- E2E: `e2e/shop.integration.spec.ts` "Wishlist" block saves a wish through the dialog, checks the panel and the "sent a note" line, re-saves after reload to confirm no second note, and checks `Escape` returns focus to the heart. Needs the shared local Supabase running.

## Notes

- The filled heart is not persisted. It reflects only a save made in this page session; reading saved wishes back would need an identity the site does not have.
- The email is plain text on purpose; HTML templates were out of scope.
- "Reply to stop" is handled manually by the owner. There is still no automated unsubscribe.
