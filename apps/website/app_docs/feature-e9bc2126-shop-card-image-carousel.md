# Shop Product Image Carousel

**ADW ID:** e9bc2126
**Date:** 2026-09-25
**Specification:** specs/issue-156-adw-e9bc2126-sdlc_planner-shop-card-image-carousel.md

## Overview

A shop product used to carry exactly one image. It now carries an ordered list of 1 to 8, and a small client island, `ProductImageCarousel`, shows one at a time with thin prev/next chevrons and touch swipe, on every `/shop` grid card and as the main image of `/shop/[slug]` (issue #156). To make room for buttons on the card, the card stopped being one big `<a>` and became an `<article>` whose product name is the link.

## What Was Built

- `images: z.array(imageSchema).min(1).max(8)` replaces `image` in the product schema, plus a `primaryImage(product)` helper used for Open Graph metadata
- Sample registry: each placeholder product has 2 or 3 images, reusing the existing `sample-0N.webp` files
- `ProductImageCarousel`, a `"use client"` component with wrap-around prev/next arrows, 50 px swipe, a screen-reader "Image N of M" live region and a PostHog event
- `ProductCard` restructured into an `<article>`: photo link (pointer only) + arrow buttons + a named link on the product name
- `/shop/[slug]` uses the same carousel (no photo link, `priority` on the first image)
- Unit, browser and Playwright tests for the new shape and behaviour

## Technical Implementation

### Files Modified

- `apps/website/src/lib/shop/schema.ts`: module-level `imageSchema` (same `/shop/` rule and messages), `images` array with 1..8 bounds, exported `ProductImage` type and `primaryImage`
- `apps/website/src/lib/shop/products.ts`: `sampleImages(word, index)`; even-indexed products get 3 images, odd 2, starting at the product's own file so its primary image is unchanged
- `apps/website/src/app/(main)/shop/ui/ProductImageCarousel.tsx` (new): the carousel island and a local `ArrowButton`
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: `<Link>` root → `<article aria-labelledby>`, carousel in the 58% photo block, name becomes the `<Link>`
- `apps/website/src/app/(main)/shop/[slug]/page.tsx`: `<Image>` → carousel; OG image from `primaryImage`
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`: article/link structure, arrows, wrap, live region, swipe, analytics, "does not navigate"
- `apps/website/src/app/(main)/shop/shop-card-edge-to-edge.browser.test.tsx`: `posthog-js` mock, since the detail page now renders the carousel
- `apps/website/src/lib/shop/__tests__/schema.unit.test.ts`, `products.unit.test.ts`: `images` bounds, per-image `/shop/` rule, `primaryImage`, 2-or-3 images per sample, every file exists
- `apps/website/e2e/shop.integration.spec.ts`: counts `article`s instead of `a[href^="/shop/"]` (two anchors per card now); new flip-then-open-by-name journey

### Key Changes

- **Card is not a link anymore.** A `<button>` inside an `<a>` is invalid HTML and navigates on every tap, so the arrows are siblings of the photo link. The photo link has `tabIndex={-1}` and `aria-hidden="true"`: it duplicates the name link, so each card announces and tab-stops on one link, not two. The article keeps `group`, so hovering anywhere on the card still underlines the name.
- **Only the current image is rendered.** The carousel renders `images[index]` alone (keyed by `src`), so hidden images are never requested. The card lazy-loads with its existing `sizes`; the detail page passes its own `sizes` and `priority`, which applies only while index is 0.
- **Navigation never leaks.** Arrow handlers call `preventDefault()` and `stopPropagation()`. A recognised swipe sets a flag that an `onClickCapture` on the wrapper uses to swallow the synthetic click a browser may fire afterwards, so swiping over the photo link doesn't navigate.
- **Deterministic first render.** The index is plain `useState(0)`, so server and client agree and `/shop` and `/shop/[slug]` stay prerendered with no hydration mismatch. Reloading resets to the first image.
- **Chevron colour.** `globals.css` has no "accent" token; the chevrons use `text-shop-card` (`--color-shop-card`, the shop cream). Single-stroke inline SVG, 24 px, stroke 1.5 (2 on hover), no background, 44 px hit area.

## How to Use

1. Open `/shop`. Cards for products with more than one image show chevrons at the photo's left and right vertical middle.
2. Click an arrow (or swipe more than 50 px on touch) to flip; it wraps at both ends and stays on `/shop`.
3. Click the photo or the product name to open `/shop/<slug>`, which has the same carousel on its main image.
4. To give a product more photos, add entries to its `images` array in `apps/website/src/lib/shop/products.ts` (files under `public/shop/`, 1 to 8 per product). The first entry is the primary image used for OG metadata.

## Configuration

None. Analytics use the existing PostHog client: each arrow or swipe change captures `shop_card_image_changed` with `{ product_slug, index, trigger: "arrow" | "swipe" }`. The same event name fires on the card and on the detail page; if they need telling apart, add a `surface` property rather than a second event.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the unit and chromium browser tests. `ProductCard.browser.test.tsx` covers: no arrows/live region/capture for one image; next/previous and wrap-around; "Image 2 of 3" in an `aria-live="polite"` node; one `img` at a time; `aria-roledescription="carousel"`; arrows not inside any `<a>`; the analytics payload; swipe over and under the 50 px threshold; an arrow click that never reaches an enclosing click handler.
- `apps/website/e2e/shop.integration.spec.ts` (manual/ADW only) flips the first card on `/shop`, checks the URL stays `/shop`, then opens the product by its name link.
- Manually: flip a card, then tab through the grid; each card should take one tab stop for the name and two for the arrows, and never the photo.

## Notes

- No carousel library, no autoplay, dots, thumbnails, lightbox or captions.
- Carousel props extend the issue's `{ images, href, slug }` with `sizes` (card and page differ) and optional `priority`. `href` is optional so the detail page doesn't link to itself.
- Anything that locates cards by `a[href^="/shop/"]` now matches two anchors per card. Locate by `article`, or by the link named after the product.
- Any browser test rendering `ProductCard` or `ProductPage` needs a `posthog-js` mock.
- All images are still placeholders; the extra images are the same six sample files in rotation.
