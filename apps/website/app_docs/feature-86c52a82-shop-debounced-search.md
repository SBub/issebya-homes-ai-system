# Debounced shop search, filtered on the server, with the current results kept visible

**ADW ID:** 86c52a82
**Date:** 2026-09-27
**Specification:** specs/issue-167-adw-86c52a82-sdlc_planner-debounced-shop-search.md

## Overview

`/shop` has a search box next to the sort control. After a 300 ms pause in typing, the URL becomes `/shop?q=<term>` (combined with `?sort=`), and the server renders page one of the products whose name contains the term, case-insensitively. Search is a server parameter exactly like sort (#165): it is part of the URL, the query key, the `"use cache"` key and the cursor, so infinite scroll keeps working inside a search and a shared link streams its results with no client fetch. While new results load, the old cards stay on screen, dimmed and `aria-busy`; the Suspense skeleton never flashes on a search change.

## What Was Built

- `filterByName`, `shopSearchSchema` (trimmed, max 60 characters), `q` in the cursor bookmark and the query key, `total` on `ProductsPage`, `CursorSearchMismatchError`, and the `shopHref` URL builder in `pagination.ts`
- `q` threaded through `getProductsPage`, `GET /api/shop/products`, the server prefetch and `ProductList`
- `useDebouncedValue(value, delayMs)`, a generic hook in `src/lib`
- `ShopControls`: a client component owning one `useTransition` for both search and sort, the dimmed grid wrapper, the empty state and analytics
- `ShopSearch`: a presentational `GET` form (`role="search"`, `<input type="search" name="q">`, hidden `sort`)
- `ShopSortControl` reduced to a controlled, presentational `<select>` (`value`, `onChange`, `busy`)
- Empty state: `Nothing matches "<term>". Try another word or clear the search.` with a Clear button
- `shop_search_applied { length, results }` PostHog event, once per applied non-empty term

## Technical Implementation

### Files Modified

- `src/lib/shop/pagination.ts`: search schema and cap, `filterByName` (runs before `sortProducts` in `selectPage`), `shopHref`, `q` in `shopProductsQueryKey(sort, q)` and in the cursor (`{ sort, q, createdAt, slug }`, `q` defaults to `""` so pre-search cursors stay valid), `decodeCursor(cursor, sort, q)`, `total`.
- `src/lib/shop/pages.ts`: `getProductsPage(cursor, limit, sort, q)`; `q` is part of the cache key.
- `src/app/api/shop/products/route.ts`: `?q=` (empty = none, over 60 characters = 400), cross-search cursor = 400 `"Cursor is for a different search"`, response carries `total`.
- `src/app/(main)/shop/ui/ShopProducts.tsx`: parses `q` leniently (`.catch("")`), prefetches page one per `(sort, q)`, reads `total` from the same cached call, renders `<ShopControls>` around the `HydrationBoundary` + `ProductList`.
- `src/app/(main)/shop/ui/ShopControls.tsx` (new), `ShopSearch.tsx` (new), `ShopSortControl.tsx` (now controlled), `ProductList.tsx` (`q` prop, sent to the API only when non-empty), `page.tsx` (comment only).
- `src/lib/use-debounced-value.ts` (new).
- `vitest.config.ts`: browser project also includes `src/lib/**/*.browser.test.tsx` (for the hook test).
- Tests: `pagination.unit.test.ts`, `route.unit.test.ts`, `use-debounced-value.browser.test.tsx` (new), `ShopControls.browser.test.tsx` (new), `ShopSortControl.browser.test.tsx` (rewritten), `ProductList.browser.test.tsx`, `e2e/shop.integration.spec.ts`.

### Key Changes

- **`startTransition` is the whole trick.** Every URL change (`router.replace` for search, `router.push` for sort) runs inside the one `useTransition` in `ShopControls`. React will not swap an already-revealed Suspense boundary back to its fallback during a transition, so the old cards stay mounted while the new server render arrives, and `isPending` drives `opacity-50` + `aria-busy` on the grid wrapper. `keepPreviousData` is not used. The browser test was checked to fail with `startTransition` removed.
- **Raw text vs applied term.** `text` is the input (every keystroke); `applied` is the trimmed term the URL should carry. The debounce, Enter, Escape, emptying the box and Clear all only set `applied`; one effect (via `useEffectEvent`) writes it to the URL, guarded by a `sentRef` so Enter followed by the debounce is one navigation, not two. This differs from the spec, which had each handler call `router.replace` directly.
- **External URL changes reset the box** (the header's Shop link, back/forward) using the adjust-state-during-render pattern, but only when no transition of ours is pending, so a server confirming an older term never overwrites text typed past it.
- **Search replaces, sort pushes.** Back leaves the shop instead of stepping through terms; sort keeps #165's back/forward behaviour. `shopHref` builds both params together, so changing either keeps the other (the old sort control dropped `q`).
- **Filter before sort and page.** `total` is the match count for the whole term (not page one's size), so the empty state and the analytics event need no second request.

## How to Use

1. Open `/shop` and type in the Search box: the URL becomes `/shop?q=<term>` after a 300 ms pause, and the grid narrows.
2. Press Enter to apply at once; press Escape or empty the box to return to `/shop` (or `/shop?sort=oldest`).
3. Change the sort: the term is kept (`/shop?sort=oldest&q=teen`).
4. Scroll: further pages load from the filtered set.
5. A term with no matches shows the empty message; Clear restores the full grid.
6. Share a `?q=` link: it opens with the same results, page one server-rendered.

API: `GET /api/shop/products?cursor=&limit=&sort=&q=`. A cursor is only valid for the sort and term that issued it.

## Configuration

None. No new dependencies or environment variables. Canonical stays `/shop`.

## Testing

- `yarn turbo run test --filter=./apps/website`: pagination (filter, trimming, case, filtered paging, `total`, cross-term cursor, legacy cursor, `shopHref` encoding), route (`q` parsing, 400s, `total`), `useDebouncedValue` (fake timers, one emission), `ShopControls` (debounce, Enter/Escape/clear, sort/search composition, old cards kept and no skeleton while pending, empty state, analytics, external reset).
- `yarn workspace website test:integration` (Playwright): search after a pause, Enter, shared link with zero API calls, infinite scroll inside `?q=product`, empty state + Clear, sort keeps search, API `q` checks, and the plain `GET` form.

## Notes

- Built on top of #163 and #165 (merged into this branch), so until PRs #164/#166 land the diff against `develop` includes their files too. Read `feature-e50e5d95-shop-infinite-scroll-grid.md` and `feature-bdeb9a75-shop-server-side-sort.md` for the paging, cursor and caching contracts this extends.
- **No-JS limitation.** The search form is a real `GET` form to `/shop`, but it lives inside the page's streamed Suspense hole, which is only revealed by an inline script. With JavaScript disabled the page never gets past the skeleton, so the form is not reachable. The e2e test therefore submits the form natively with `form.submit()` (bypassing React's `onSubmit`) with JS on, instead of running with `javaScriptEnabled: false` as the spec planned.
- A typed search normally makes zero `/api/shop/products` requests for page one: the RSC payload of the `router.replace` carries it hydrated.
- On the page, a hand-typed over-long or repeated `?q=` falls back to the full grid; on the API an over-long `q` is a 400.
- Every distinct `(cursor, limit, sort, q)` is a `"use cache"` entry; acceptable with the 60-character cap and a tiny catalogue, revisit if products move to the database.
- Out of scope: searching description or brand, fuzzy matching, highlighting, search on other pages.
