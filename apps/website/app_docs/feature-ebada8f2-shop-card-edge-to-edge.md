# Shop Product Detail and Offer-a-Piece Cards Go Edge to Edge

**ADW ID:** ebada8f2
**Date:** 2026-09-25
**Specification:** specs/issue-151-adw-ebada8f2-sdlc_planner-shop-card-edge-to-edge.md

## Overview

The yellow `bg-shop-card` block on the product detail page (`/shop/[slug]`) and the Offer-a-piece page (`/shop/sell`) used to sit inside page padding, so a grey frame of page background showed around it. Both cards now span the full width of `<main>` and meet the footer directly, matching the shop index's `bg-shop-ground` section. Only the breadcrumb stays on the page background, above the card (issue #151).

## What Was Built

- Page padding removed from the `<article>` wrapper on both pages
- Breadcrumb wrapped in its own padded strip above the card
- Card padding moved inside the card and widened to line up with the shop index
- A browser regression test covering both pages

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/shop/[slug]/page.tsx`: `<article>` loses `p-4 md:p-12`; breadcrumb wrapped in `<div className="px-4 pt-4 md:px-12 md:pt-12">`; card padding changed from `p-4 md:p-8` to `px-4 py-8 md:px-12 md:py-12` (keeps `grid md:grid-cols-2 gap-8`).
- `apps/website/src/app/(main)/shop/sell/page.tsx`: the same three changes (keeps `flex flex-col gap-6` and the intro's `max-w-[65ch]`).
- `apps/website/src/app/(main)/shop/shop-card-edge-to-edge.browser.test.tsx` (new): renders both pages and checks the layout contract.

### Key Changes

- No negative margins, no `100vw`: the card is full width simply because nothing around it adds horizontal padding (`(main)/layout.tsx` renders `<main className="flex-1">` with none).
- The breadcrumb strip's `px-4 md:px-12` equals the card's inner horizontal padding, so breadcrumb text lines up with the card content and with the index section.
- The gap between breadcrumb and card comes from `Breadcrumb`'s own `mb-4`; the card has no outer margin. `Breadcrumb` itself is unchanged.
- No `min-h-[…]`, because the index page does not use one either; with the article's bottom padding gone the card's bottom edge touches the footer.
- The product `<Image>` (`aspect-square`, `sizes`, `priority`) is untouched, and both routes stay prerendered (markup-only change).

## How to Use

1. Open `/shop/<any-product-slug>` or `/shop/sell`.
2. The breadcrumb sits on the grey page background at the top.
3. The yellow card below it runs from the left edge of the viewport to the right edge and down to the footer, at desktop (padding `md:px-12`) and at 390 px mobile (padding `px-4`).

## Configuration

None.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the new `shop-card-edge-to-edge.browser.test.tsx` (gated on push and in CI). For each page it asserts:
  - the `<article>` carries no `p-4` / `md:p-12` / `px-4` / `md:px-12`;
  - the card carries `px-4 py-8 md:px-12 md:py-12` and not `p-4` / `md:p-8`;
  - the card's bounding box `left` and `width` match the render container's (real layout, since the browser setup loads `globals.css`);
  - the breadcrumb `nav` is outside the card and above it.
- The test mocks `WishlistDialog` and `SellerForm` wholesale, plus `next/link` and `next/image`, so no Supabase/PostHog/Sentry code loads. Those islands have their own browser tests.
- Existing flows still run through `e2e/shop.integration.spec.ts`.

## Notes

- `shop/wishlist/unsubscribe/ui/UnsubscribeMessage.tsx` still uses the old `bg-shop-card p-4 md:p-8` pattern inside a padded wrapper. It was out of scope for this issue and could be a follow-up.
- The two pages share the "breadcrumb strip + edge-to-edge card" shape but differ in layout (grid vs flex). A shared wrapper component was deliberately not extracted.
- If a third page adopts this shape, keep the breadcrumb strip's horizontal padding equal to the card's, or the text edges stop lining up.
