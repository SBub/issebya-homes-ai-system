# Shop grid sorted on the server (newest / oldest) with a (date, slug) cursor

**ADW ID:** bdeb9a75
**Date:** 2026-09-27
**Specification:** specs/issue-165-adw-bdeb9a75-sdlc_planner-sort-shop-grid-server-side.md

## Overview

The `/shop` grid used to follow the registry's array order. Every product now has a `createdAt` calendar day, and the grid order is a server parameter, `sort = newest | oldest` (default `newest`). The server sorts inside the same function that pages, and the keyset cursor is now a bookmark of the last item shown in that order, `{ sort, createdAt, slug }`, so paging stays correct when products are added or removed between page loads. A sort control above the grid switches the order and keeps it in the URL (`/shop?sort=oldest`).

## What Was Built

- Required `createdAt: "yyyy-MM-dd"` on every product (schema + all fifteen samples, with at least two sharing a day)
- One comparator in `pagination.ts`: `newest` = `createdAt` desc then `slug` asc; `oldest` is its exact negation
- A tuple cursor `base64url(JSON.stringify({ sort, createdAt, slug }))`, Zod-validated on decode
- `sort` threaded through `getProductsPage`, `GET /api/shop/products`, the server prefetch and the TanStack Query key
- `ShopSortControl`: a native `<select>` ("Newest first" / "Oldest first") that writes the URL and captures `shop_sort_changed`

## Technical Implementation

### Files Modified

- `src/lib/shop/schema.ts`: exported `calendarDaySchema` (`z.iso.date()`, rejects `2026-02-30` and bad shapes); `productSchema` gains `createdAt`.
- `src/lib/shop/products.ts`: a `createdAt` per sample, deliberately out of array order.
- `src/lib/shop/pagination.ts`: `SHOP_SORTS`, `shopSortSchema`, `ShopSort`, `DEFAULT_SHOP_SORT`, `shopProductsQueryKey(sort)`, `sortProducts`, `encodeCursor`/`decodeCursor(cursor, sort)`, `CursorSortMismatchError`, and `selectPage(products, cursor, limit, sort)`.
- `src/lib/shop/pages.ts`: `getProductsPage(cursor, limit, sort)`; still `"use cache"`, tag `shop-products`, `cacheLife("days")`, one entry per `(cursor, limit, sort)`.
- `src/app/api/shop/products/route.ts`: `sort` query param (enum, default `newest`, empty = default, unknown = 400); cursor decoded against the sort outside the cache; garbage or cross-sort cursor = 400.
- `src/app/(main)/shop/page.tsx`: passes the `searchParams` promise into the Suspense hole without awaiting it.
- `src/app/(main)/shop/ui/ShopProducts.tsx`: awaits `searchParams`, parses `sort` leniently, prefetches page one via cached `getFirstPageState(sort)`, renders `ShopSortControl` + `ProductList sort={sort}`.
- `src/app/(main)/shop/ui/ProductList.tsx`: `sort` prop, sort in the query key and in the API request (omitted when default).
- `src/app/(main)/shop/ui/ShopSortControl.tsx` (new): the sort control.
- Tests: `pagination.unit.test.ts`, `route.unit.test.ts`, `schema.unit.test.ts`, `products.unit.test.ts`, `ProductList.browser.test.tsx`, `ShopSortControl.browser.test.tsx` (new), `index-pages-no-title-heading.browser.test.tsx`, `e2e/shop.integration.spec.ts`; `Product` literals in other browser tests gained `createdAt`.

### Key Changes

- **Strings, not `Date`.** `yyyy-MM-dd` is zero-padded, so it sorts lexicographically in chronological order. Both dates and slugs use plain code-point comparison (not `localeCompare`), so the order cannot drift with the runtime's ICU data.
- **Slug is the tie-breaker** because it is unique, which makes the order total. Without it, products sharing a day could swap between requests and be duplicated or skipped across a page boundary. `oldest` sorts slug descending so it is literally `newest` reversed.
- **Keyset by tuple, not by slug lookup.** `selectPage` keeps items that compare strictly after the bookmark. The bookmarked product no longer has to exist: a removed product means "continue after where it was" (this used to be a 400 in #163). Legacy `after:<slug>` cursors decode as garbage (400).
- **Sort is part of every key.** The server cache key (page one differs per sort), the dehydrated first-page state, and `shopProductsQueryKey(sort)`. A new sort is a new query, so React Query starts at page one with no manual cache reset.
- **Only the hole is dynamic.** The page never awaits `searchParams`; `ShopProducts` does, inside `<Suspense>`, so the section and sell link stay in the static shell. The control reads `sort` as a prop from the server rather than `useSearchParams`, keeping one source of truth.
- **Control uses `router.push`, not `router.replace`.** The spec asked for `replace`; the implementation switched to `push` so each choice gets a history entry and back/forward restore the previous order. `useOptimistic` shows the new value immediately while the transition fetches the new server render. `newest` pushes the bare pathname, `oldest` pushes `?sort=oldest`, both with `{ scroll: false }`.

## How to Use

1. Open `/shop`: the grid shows the newest products first.
2. Use the **Sort** select above the grid and pick "Oldest first": the URL becomes `/shop?sort=oldest` and the grid restarts from the oldest product.
3. Scroll: further pages load in the chosen order.
4. Share `/shop?sort=oldest`: it opens in that order with page one server-rendered.
5. Browser back restores the previous order.
6. When adding a product to `src/lib/shop/products.ts`, give it a `createdAt` (`yyyy-MM-dd`); the build fails schema validation without one.

API: `GET /api/shop/products?cursor=&limit=&sort=newest|oldest`. A cursor is only valid for the sort that issued it.

## Configuration

None. No new dependencies or environment variables. The page's canonical stays `/shop` for both sorts (same content).

## Testing

- `yarn workspace website test` runs the node-pool unit tests (comparator, tie-break across a page boundary, insert/remove between pages, cursor round-trip, sort mismatch, route validation and full walks for both sorts).
- Browser tests: `ShopSortControl.browser.test.tsx` (URL written, default leaves no query string, analytics event) and `ProductList.browser.test.tsx` (query key changes with sort).
- `e2e/shop.integration.spec.ts`: newest order by default, the sort control round-trip including infinite scroll and `goBack()`, cross-sort cursor 400, and a shared `?sort=oldest` link that makes no API call for page one.

## Notes

- Built on top of #163 (`feature-e50e5d95-shop-infinite-scroll-grid.md`), merged into this branch; until #164 lands, the diff against `develop` includes #163's files too. Read that doc for why the cursor is checked outside the cache, why page one is dehydrated inside `"use cache"`, and why `refetchOnMount: false`.
- A hand-typed `?sort=foo` on the page shows the default order (lenient `.catch`); on the API it is a 400.
- To make slugs ascending within a day in both orders instead, change the one comparator and its test fixtures.
- Out of scope: sorting by price or name (would need the same tie-breaker treatment), filters, search, persisting the choice beyond the URL.
