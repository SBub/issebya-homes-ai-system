# Shop Wishlist: Bordered "Save to wishlist" Trigger

**ADW ID:** 091cac99
**Date:** 2026-09-24
**Specification:** specs/issue-150-adw-091cac99-sdlc_planner-wishlist-trigger-bordered-button.md

## Overview

On `/shop/[slug]` the wishlist trigger next to the price is now a bordered, uppercase, letter-spaced button with the heart before the text: "Save to wishlist", and "Saved to wishlist" with a filled heart after a successful save. This matches the owner's specified look and the house label style, and replaces the "Add to wishlist" / "Added to wishlist" wording that #147 introduced. Behaviour is unchanged: same `<dialog>`, form, confirmation panel, email and in-memory saved state.

## What Was Built

- Restyled trigger button in `WishlistDialog.tsx`: inline Tailwind (no new component, CSS class or dependency), 16 px heart first, then the label
- Relabelled copy constants: `WISHLIST_SAVE_LABEL` ("Save to wishlist") and `WISHLIST_SAVED_LABEL` ("Saved to wishlist") replace `WISHLIST_ADD_LABEL` / `WISHLIST_ADDED_LABEL`
- Browser and Playwright tests moved to the new names, with the submit-button name collision handled
- README and the three earlier wishlist feature docs updated to the new wording

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx`: trigger classes replaced (was `.button-outline`), icon shrunk to `w-4 h-4 shrink-0`, `heartRef` renamed `triggerRef`, labels switched to the new constants
- `apps/website/src/lib/shop/wishlist.ts`: `WISHLIST_SAVE_LABEL` / `WISHLIST_SAVED_LABEL`, with a comment warning that the dialog's submit shares the "Save to wishlist" name
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx`: trigger located with `.first()`, submit queries scoped to the dialog, new assertions for label, no `aria-label`, and heart-before-text order
- `apps/website/e2e/shop.integration.spec.ts`: wishlist journeys click the trigger by `WISHLIST_SAVE_LABEL` with `exact: true`, assert `WISHLIST_SAVED_LABEL` + `aria-pressed="true"` + filled heart after save
- `apps/website/README.md`, `app_docs/feature-972c79dc-*`, `feature-bcb9a5cf-*`, `feature-3b203d9a-*`: wording updated

### Key Changes

- Trigger classes: `inline-flex items-center gap-2 min-h-11 px-5 py-3 border border-foreground/60 text-foreground/70 uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-foreground hover:text-foreground`. `min-h-11` keeps the 44 px hit area (padding + line height + border alone is 42 px).
- Label text is sentence case in source; CSS `uppercase` renders the caps, so screen readers read a sentence. The visible text is the accessible name; there is no `aria-label`. `aria-pressed` (absent, then `true`) and `aria-haspopup="dialog"` are unchanged.
- `border-foreground/60` and `text-foreground/70` derive from the `--color-foreground` theme token, so they follow dark mode.
- `.button-outline` (from #147) is no longer used by the trigger; it remains in `globals.css` for the booking Close button. Inline Tailwind was chosen because the style has one call site.
- The price row in `page.tsx` already had `flex flex-wrap items-center gap-3` from #147, so the button wraps under the price on narrow screens without a change here.

## How to Use

1. Open any product at `/shop/<slug>`.
2. Next to the price, click "SAVE TO WISHLIST" (heart on the left). The "Save to your wishlist" dialog opens.
3. Enter an email, tick the consent box and click the dialog's "Save to wishlist".
4. The trigger now reads "SAVED TO WISHLIST" with a filled heart. After a reload it reads "Save to wishlist" again (in-memory by design).

## Configuration

None.

## Testing

- `yarn turbo run test --filter=./apps/website` runs `WishlistDialog.browser.test.tsx` (gates on push/CI): label, no `aria-label`, `aria-pressed`, heart state and heart-before-text order.
- `apps/website/e2e/shop.integration.spec.ts` (ADW test phase, on the run's `PORT`): full save journey, reload reset, Escape returns focus to the trigger.
- Styling (border, tracking, colours, wrap) is not asserted; check visually at 1280 px and 390 px widths.

## Notes

- Name collision: while the dialog is open there are two buttons named "Save to wishlist" (the trigger and the dialog's submit). Scope submit queries to the dialog, and take the trigger with `.first()` or query it while the dialog is closed (the form only mounts when open). "Saved to wishlist" is unique.
- This branch merged develop after #147 landed; the patch spec `specs/patch/patch-adw-091cac99-merge-develop-save-to-wishlist-labels.md` records replacing #147's labels with these.
- Out of scope: the dialog itself, the email, unsubscribe, and the product grid.
