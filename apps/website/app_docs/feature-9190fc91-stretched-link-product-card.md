# Whole shop product card presses through to the product page

**ADW ID:** 9190fc91
**Date:** 2026-09-29
**Specification:** specs/issue-188-adw-9190fc91-sdlc_planner-stretched-link-product-card.md

## Overview

On `/shop`, only a card's name and photo used to navigate. The brand, price, description and the cream padding around them did nothing when pressed, although the card looks pressable. That was about 40% of the card. Now a press anywhere on the card opens `/shop/<slug>`. The photo arrows and swipe still flip images, and the card still has exactly one accessible link (issue #188).

## What Was Built

- A CSS-only "stretched link": the product name `<Link>` gets an `::after` that covers the whole `<article>`.
- The photo region sits above that overlay, so the carousel keeps its photo link, arrow buttons and touch swipe.
- Browser tests that hit-test the real layout to prove both halves.
- A Playwright test that clicks a card's description and lands on the product page.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: `relative` on the `<article>`, `z-10` on the photo wrapper, `after:absolute after:inset-0 after:content-['']` on the name link, and a rewritten doc comment explaining why.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`: two new tests, "the description and price press through to the name link" and "the photo stays on top of the stretched link".
- `apps/website/e2e/shop.integration.spec.ts`: new test "pressing a card's description opens the product". It also fixes a flaky sell-link test: "the shop links to the sell page" now waits for infinite scroll to finish growing the grid before it clicks the link under it.

### Key Changes

- **`relative` goes on the article's own `className`, not in `PRODUCT_CARD_BOX_CLASS`.** That constant is shared with `ProductGridSkeleton`, and its size-parity test expects the two to match byte for byte.
- **The overlay is the name link's own pseudo-element.** When the browser hit-tests a pseudo-element, it returns the element that owns it. So a press on the text lands on the real name `<a href>`. Middle-click, cmd-click, "Open in new tab" and `<Link>` prefetch all work, and no `onClick`, `router.push` or `'use client'` is needed.
- **The photo wrapper is `z-10`.** Over the photo, the pointer still reaches the carousel: its pointer-only `aria-hidden` photo link, its chevron `<button>`s and its `role="group"` touch handlers. If the overlay covered the photo, touch events would go to the name `<a>` instead of the carousel, and swipe would break. `ProductImageCarousel.tsx` is unchanged.
- **The card is still an `<article>`, not one big `<a>`.** The arrows are buttons, and a button inside an anchor is invalid HTML that navigates on every tap.
- **Accepted trade-off:** you can no longer select the description or price text by dragging. Don't "fix" this with `pointer-events`. That brings back the dead area.

## How to Use

1. Open `/shop`.
2. Press anywhere on a card outside the photo: brand, name, price, description or padding. You land on `/shop/<slug>`.
3. Over the photo, a click opens the product, the "Previous image"/"Next image" arrows flip images without navigating, and swipe on touch devices still flips images.
4. Keyboard use doesn't change. The name is still the only focusable link, and its focus ring still outlines the name text only.

## Configuration

None. This needs Tailwind v4's `after:` variant, which only creates the pseudo-element when `after:content-['']` is present. Keep that class.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the browser tests. They render the card in a 300px-wide wrapper so it fits the viewport, because `elementFromPoint` returns `null` off-screen. They then check what sits at the centre of the description, price, brand, photo and "Next image" button. Both new tests were checked against a broken build: without the `after:*` classes the text test fails, and without `z-10` the photo test fails.
- `yarn workspace website test:integration` runs the Playwright test. It clicks with `page.mouse.click` at the description's coordinates, not `locator.click()`. Playwright's actionability check reports the stretched `::after` as "intercepts pointer events", which is exactly the behaviour under test. This suite is not in CI. It runs in the ADW test phase.
- These existing tests still pass unedited and guard the one-link contract: "the card is an article whose only accessible link is the product name", "the arrows are not inside the link", the swipe test, and the e2e `getByRole("article").getByRole("link")` `toHaveText(names)` assertions.

## Notes

- The spec's e2e test also clicked an arrow and checked that the page stayed on `/shop`. The implementation leaves that out, because the existing "flipping a card's images stays on /shop" test already covers it.
- The overlay follows the article's box at any height, including the `md:max-lg` range where the card uses `min-h` instead of `aspect-[3/5]`.
- `/shop/[slug]` renders the carousel without `ProductCard`, so this change doesn't affect it.
- For the card's link structure and carousel, see `feature-e9bc2126-shop-card-image-carousel.md`.
