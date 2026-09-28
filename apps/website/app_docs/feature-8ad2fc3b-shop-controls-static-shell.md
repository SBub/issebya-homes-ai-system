# Shop Controls in the Static Shell

**ADW ID:** 8ad2fc3b
**Date:** 2026-09-28
**Specification:** specs/issue-176-adw-8ad2fc3b-sdlc_planner-shop-controls-static-shell.md

## Overview

On `/shop` the search box and sort select used to be rendered inside the product list's Suspense hole, so a first visit showed the skeleton grid with no controls, and when page one arrived the controls row appeared and pushed every card down. The controls now read `sort` and `q` from the URL themselves and sit in the page's static shell, with a same-size disabled fallback in the prerendered HTML, so the row is on screen from the first byte and the list fills in underneath without anything moving (issue #176).

## What Was Built

- `ShopControls` takes only `children`: `sort` and `q` come from `useSearchParams()`, parsed by the same helper the server uses.
- `ShopControlsFallback`: the outer `<Suspense>` fallback. Same search form and sort select (disabled, default values) and same grid wrapper around the grid skeleton, so the prerendered HTML already has the controls at their final size.
- `ShopResults`: a small client component inside the list's Suspense hole that owns the page-one-dependent parts, the empty state ("Nothing matches ...", Clear) and the `shop_search_applied` analytics report.
- A `ShopControls` context (`useShopControls()` returning `{ clear, reportResults }`) so `ShopResults` reuses the controls' `clear` and "did the visitor ask for this term" check instead of duplicating them.
- Shared URL parsing: `parseShopParams` and `shopParamsFromSearch` in `src/lib/shop/pagination.ts`.
- An optional `disabled` prop on `ShopSearch` and `ShopSortControl`.
- Two nested Suspense boundaries in `page.tsx`, with `ShopGridBoundary` moved inside `ShopControls` so a failed page one keeps the controls usable.

## Technical Implementation

### Files Modified

- `src/app/(main)/shop/page.tsx`: recomposed into outer Suspense (`ShopControlsFallback` + skeleton) → `ShopControls` → `ShopGridBoundary` → inner Suspense (skeleton) → `ShopProducts`. Still never awaits `searchParams`.
- `src/app/(main)/shop/ui/ShopControls.tsx`: drops the `sort`/`q`/`total` props, derives them from `useSearchParams()`, provides the context, and no longer renders the empty state or captures analytics itself. `clear` and `reportResults` are stable `useCallback`s (refs and setters only), and the context value is memoised.
- `src/app/(main)/shop/ui/ShopControlsFallback.tsx` (new): exports `SHOP_CONTROLS_ROW_CLASS` (row classes plus `min-h-[104px] min-[500px]:min-h-11`, measured) and `SHOP_GRID_WRAPPER_CLASS`, both shared with `ShopControls`.
- `src/app/(main)/shop/ui/ShopResults.tsx` (new): renders the empty state or `children`, and calls `reportResults(q, total)` in an effect once the server-confirmed results commit.
- `src/app/(main)/shop/ui/ShopProducts.tsx`: uses `parseShopParams(await searchParams)`, wraps the `HydrationBoundary` in `ShopResults` instead of `ShopControls`. Page-one prefetch and query key are unchanged.
- `src/app/(main)/shop/ui/ShopSearch.tsx`, `ShopSortControl.tsx`: optional `disabled`, passed to the input/select only, with no class changes (the disabled look must not change box size).
- `src/app/(main)/shop/ui/ShopGridBoundary.tsx`: doc comment updated for its new placement.
- `src/lib/shop/pagination.ts`: `parseShopParams(record)` and `shopParamsFromSearch(URLSearchParams)`. The second rebuilds Next's `searchParams` record shape (once → string, repeated → `string[]`, absent → `undefined`) and delegates, so `?sort=bogus` or `?q=a&q=b` resolve identically on client and server.
- `ENGINEERING.md`: new "Shop controls in the static shell" section; "Shop grid error boundary" updated.

### Key Changes

- **Controls depend on the URL only.** `useSearchParams` in a prerendered route renders nothing in the shell but its nearest Suspense fallback. That is why the outer boundary and `ShopControlsFallback` exist: the fallback is what lands in the prerendered HTML.
- **Same DOM, same size.** Fallback and live row share the row and grid-wrapper classes. The explicit min height is belt-and-braces against font loading or future markup drift: two 44 px lines below a ~500 px viewport, one line above.
- **Data stays in the hole.** Nothing on screen shows a match count. `total` only drives the empty state and the analytics event, both of which moved into `ShopResults` inside the list's Suspense.
- **Reconciliation keeps one implementation.** `useTransition`, the optimistic sort, the debounce, `seenQ`, push-for-sort / replace-for-search and the dimmed `aria-busy` grid wrapper are unchanged in `ShopControls`. Only the source of `sort`/`q` changed.
- **The error boundary sits inside the controls.** `ShopGridBoundary` wraps only the inner Suspense, so a failed page one shows the error message under working controls.

## How to Use

1. Open `/shop`. The search box and sort select are visible immediately, disabled and showing defaults until hydration, above the skeleton grid.
2. Once hydrated, the controls show the URL's values (e.g. `/shop?sort=oldest&q=silver`) and work as before: typing debounces into `?q=`, sort pushes `?sort=`.
3. A term with no matches shows the empty state with Clear, rendered from the list's hole.

## Configuration

None. No new dependencies or environment variables.

## Testing

- `src/lib/shop/__tests__/pagination.unit.test.ts`: `parseShopParams` / `shopParamsFromSearch` agree on valid, malformed, over-long and repeated params.
- `ShopControls.browser.test.tsx`: the harness mocks `useSearchParams` through a test-local React context (not a module variable, so a pending transition keeps seeing the old URL). It adds "reads sort and q from the URL" and "a malformed URL shows the defaults".
- `ShopResults.browser.test.tsx`: empty state + Clear, and the once-per-term `shop_search_applied` report.
- `ShopControlsFallback.browser.test.tsx`: fallback and live row have equal height and equal grid offset at 390 px and 1280 px, meet the min height, and the fallback's inputs are disabled.
- `e2e/shop.integration.spec.ts`: "the controls are in the page HTML", plus a layout-stability test at 390 px and 1280 px. It compares the search box and first grid slot positions from the skeleton frame to the first cards, and asserts zero layout shift in the products section.
- `yarn turbo run build --filter=./apps/website`: `/shop` must still print `◐` (Partial Prerender).

## Notes

- `next dev` does not suspend on `useSearchParams`, so the fallback never renders on the dev server and the layout-stability e2e cannot fail there. To exercise the prerendered shell, run it against `next start` with `PORT` set.
- For a shared `?sort=oldest&q=teen` link, the prerendered controls briefly show the defaults before hydration swaps in the URL's values. The size is the same, so nothing moves. This is forced by the static shell and is intended.
- Browser tests that render the real `shop/page.tsx` (`index-pages-no-title-heading.browser.test.tsx`) must mock `ShopControls`, since it calls `useRouter`/`useSearchParams`.
- Never pass a `useEffectEvent` function through the context. `reportResults` is a plain stable callback on purpose.
