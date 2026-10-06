# Shop Toolbar: Same Sort Box in Every Browser, Tighter Top Spacing

**ADW ID:** 3ecb6844
**Date:** 2026-10-06
**Specification:** specs/issue-223-adw-3ecb6844-sdlc_planner-shop-toolbar-safari-spacing.md

## Overview

The `/shop` toolbar (Search and Sort on the grey `bg-shop-ground` band) rendered differently in Safari: the sort `<select>` fell back to the native macOS pill, ignored the 44 px height, and sat lower than the search field. The sort control now draws the same bordered 44 px box with our own chevron in every browser, the two controls are vertically centred on one row, and the band has less empty space above them.

## What Was Built

- Sort `<select>` with its native appearance reset, a fixed 44 px height and an inline SVG chevron
- Search input pinned to the same fixed 44 px height
- Controls row centred (`items-center`) instead of bottom-aligned
- Smaller top padding on the products band, bottom padding unchanged
- Browser regression tests for the appearance reset and for equal height and shared centre

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/shop/ui/ShopSortControl.tsx`: `<select>` wrapped in a `relative` div; `appearance-none`, explicit `[-webkit-appearance:none]`, `rounded-none`, `h-11`, `pl-3 pr-8`; an `aria-hidden`, `pointer-events-none` SVG chevron positioned at the right. Still a native `<select>` with its `<label htmlFor>`.
- `apps/website/src/app/(main)/shop/ui/ShopSearch.tsx`: input gets `h-11` next to `min-h-11`.
- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.tsx`: `SHOP_CONTROLS_ROW_CLASS` uses `items-center` instead of `items-end`. Shared with `ShopControls`, so the fallback and live rows stay identical.
- `apps/website/src/app/(main)/shop/page.tsx`: band padding `py-10 md:py-16` became `pt-4 pb-10 md:pt-6 md:pb-16`.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.browser.test.tsx`: asserts computed `appearance` is `none`, height 44, and the chevron SVG is present.
- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.browser.test.tsx`: adds widths 490 and 505 around the wrap breakpoint, and asserts search and sort share height 44 and a vertical centre in both rows.
- `apps/website/e2e/shop.integration.spec.ts`: the product-click URL assertion gets a 15 s timeout, because on a fresh dev server that click is the first visit to `/shop/[slug]` and the route compiles lazily.

### Key Changes

- WebKit ignores author height and border on a native-appearance select, which is why Safari differed from Chrome. Resetting `appearance` (plus the `-webkit-` form) makes both engines paint our box.
- Equal fixed heights are what make `items-center` give a common centre line in every engine.
- The measured `min-[500px]` wrap breakpoint did not change: the extra chevron padding left the one-line fit within it (tests at 490 px and 505 px confirm fallback and live rows still match).
- `min-h-screen` on the band stays so the footer does not jump while the skeleton or an empty search result shows.

## How to Use

1. Open `/shop` on desktop: Search and Sort sit on one row as matching 44 px bordered boxes, with a small grey margin above.
2. Below about 500 px the sort wraps under the search, as before.
3. The sort stays a native, labelled `<select>`: `getByLabel("Sort").selectOption(...)` still works.

## Configuration

None. No new dependency; the chevron is inline SVG.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the new chromium browser tests.
- Safari cannot be covered by the gate (webkit cannot launch on macOS 14 arm64); the asserted computed `appearance: none` plus the explicit `-webkit-appearance: none` is the guarantee. Eyeball `/shop` in desktop Safari before merging.

## Notes

- Keep `className="text-foreground"` on the `<option>` elements: with a transparent select background the options render on the OS light menu and need dark text.
- `next dev` does not suspend on `useSearchParams`, so fallback/live parity is only visible in a production build; the browser test is the reliable check.
- Related: `feature-8ad2fc3b-shop-controls-static-shell.md` explains why the row height is pinned.
