# Shop Infinite Scroll Grid

**ADW ID:** e50e5d95
**Date:** 2026-09-27
**Specification:** specs/issue-163-adw-e50e5d95-sdlc_planner-shop-infinite-scroll-grid.md

## Overview

`/shop` used to render the whole product registry in one pass. It is now an infinite list (issue #163): the first six products arrive with the prerendered page, and later pages of six load from a cached API route as the visitor scrolls or presses "Load more". TanStack Query v5 manages the list on the client. Only the list sits in `<Suspense>`, and its skeleton boxes are exactly card-sized, so the layout does not jump.

## What Was Built

- Keyset pagination with an opaque cursor, `base64url("after:<slug>")`, over the product registry. Six items per page (`SHOP_PAGE_SIZE`)
- `getProductsPage(cursor, limit)`: the single server data function, cached with `"use cache"`, `cacheTag("shop-products")` and `cacheLife("days")`
- `GET /api/shop/products?cursor=&limit=`: Zod-validated. Returns `{ items, nextCursor }`, or 400 on a bad query or unknown cursor
- A shop-scoped `QueryClientProvider` mounted by a new `shop/layout.tsx`, so loaded pages survive navigating to a product and back
- A server-side prefetch of page one, dehydrated into a `HydrationBoundary`, so the client never fetches page one
- `ProductList`, a client component using `useSuspenseInfiniteQuery`: `IntersectionObserver` sentinel, a visible "Load more" button, a smaller skeleton while the next page loads, and a retry line on next-page errors that keeps loaded cards on screen
- `ProductGridSkeleton`, which shares the grid and card-box classes with the real list
- PostHog event `shop_products_page_loaded { page_index, items }` for every page after the first
- The sample registry grows from 6 to 15 entries (pages of 6, 6 and 3)

## Technical Implementation

### Files Modified

- `apps/website/src/lib/shop/pagination.ts` (new): `SHOP_PAGE_SIZE`, `SHOP_PRODUCTS_QUERY_KEY`, `ProductsPage`, `encodeCursor`/`decodeCursor`, `UnknownCursorError`, `cursorStart` and `selectPage`. Imports only the `Product` type, so it is safe on the client and in the node test pool
- `apps/website/src/lib/shop/pages.ts` (new): the cached `getProductsPage`
- `apps/website/src/lib/shop/query-client.ts` (new): `makeShopQueryClient()`, shared by server and client. `staleTime`/`gcTime` of one hour, and it dehydrates pending queries as well
- `apps/website/src/app/api/shop/products/route.ts` (new): the route handler
- `apps/website/src/app/(main)/shop/layout.tsx` (new) and `ui/ShopProviders.tsx` (new): the query provider
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` (new): an async server component. Its cached `getFirstPageState()` prefetches page one through `getProductsPage` and returns the dehydrated state
- `apps/website/src/app/(main)/shop/ui/ProductList.tsx` (new): the infinite list
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx` (new): card-sized placeholders plus the shared `PRODUCT_GRID_CLASS`
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: its outer box classes move into the exported `PRODUCT_CARD_BOX_CLASS`
- `apps/website/src/app/(main)/shop/page.tsx`: `allProducts.map` is replaced by `<Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}><ShopProducts /></Suspense>`
- `apps/website/src/lib/shop/products.ts`: 15 sample entries
- `apps/website/package.json`, `vitest.config.ts`: `@tanstack/react-query` dependency, added to the browser project's `optimizeDeps.include`
- Tests: `pagination.unit.test.ts`, `route.unit.test.ts`, `ProductList.browser.test.tsx`, `ProductGridSkeleton.browser.test.tsx`, an updated `products.unit.test.ts`, `index-pages-no-title-heading.browser.test.tsx` (mocks `ShopProducts`), and `e2e/shop.integration.spec.ts`
- `apps/website/e2e/booking-flow.integration.spec.ts`, `blog-booking-flow.integration.spec.ts`: copy updates to the availability-error assertions. These are unrelated to the shop change

### Key Changes

- **The cursor is keyset, not an offset.** A cursor names the slug the next page starts after. If that slug leaves the registry, the cursor is rejected (`UnknownCursorError` → 400) rather than silently shifting items. `nextCursor` is `null` when a page reaches the end, so an exact multiple of six never returns an empty trailing page.
- **Cursors are validated outside the cache.** An error thrown inside a `"use cache"` scope loses its class on the way out. So the route calls `cursorStart` first to tell a bad cursor (400) apart from a real failure (500, reported to Sentry). A bad cursor never becomes a cache entry.
- **Page one is prefetched inside a cache scope.** `QueryClient` and `dehydrate` read `Date.now()`, which fails the Cache Components prerender (`next-prerender-current-time`) outside a cache scope. `getFirstPageState()` is therefore `"use cache"` itself, awaited, and tagged `shop-products`, and `/shop` stays in the static shell. This differs from the spec, which planned an un-awaited `prefetchInfiniteQuery`.
- **`refetchOnMount: false` on the client query.** The hydrated page one carries the time its cache entry was filled, which is often more than an hour old. Without this flag, the client would refetch the page the prefetch exists to supply.
- **The sentinel uses a callback ref.** The observer is created only while `hasNextPage && !isFetchingNextPage`, disconnects on its first intersection, and is recreated when that condition changes. A sentinel still in view after a page lands triggers the next page.

## How to Use

1. Open `/shop`. The first six product cards render with the page.
2. Scroll down. When the sentinel comes within 400px of the viewport, the next six load, with three skeleton cards showing meanwhile.
3. Or press "Load more", which is shown while more pages remain.
4. If a next page fails, a "Couldn't load more products. Try again" line appears and the loaded cards stay on screen.
5. API consumers: `GET /api/shop/products?limit=6&cursor=<nextCursor>`. `limit` is an integer from 1 to 24 (default 6). An empty `cursor` means "from the start".

## Configuration

- No environment variables.
- Page size: `SHOP_PAGE_SIZE` in `src/lib/shop/pagination.ts`. The server prefetch, client query key, API default and skeleton count all read from it.
- Cache: profile `cacheLife("days")`, tag `shop-products`. If products change at runtime, call `revalidateTag("shop-products")` (a deploy rebuilds anyway).
- Client cache: one-hour `staleTime`/`gcTime` in `makeShopQueryClient`.

## Testing

- Unit (node pool): `yarn workspace website test` runs `pagination.unit.test.ts` (cursor codec, pages, end-of-list, unknown cursors) and `route.unit.test.ts` (400/200/500 paths, with `next/cache` mocked).
- Browser: `ProductList.browser.test.tsx` covers appending pages, Load more, the next-page skeleton, retry after an error, and PostHog capture. `ProductGridSkeleton.browser.test.tsx` covers box sizing against the real card.
- E2E (`e2e/shop.integration.spec.ts`, not gating): page one shows six cards, scrolling reaches all 15, Load more works, page one makes no `/api/shop/products` request, and the API returns an opaque cursor and rejects `limit=30`.

## Notes

- Any browser test that renders the `/shop` page must mock `./shop/ui/ShopProducts`, because it pulls in `next/cache` and the server registry.
- A new browser-suite dependency must go in `optimizeDeps.include`. See `feature-cc081a8b-gate-browser-tests-in-ci.md`.
- Fetching from a client component is a deliberate exception to `data-fetching-client.md`, and the reason is recorded in the `ProductList` comment. Only pages 2 and later come from the browser.
- The 15 sample entries also add prerendered `/shop/[slug]` pages and sitemap URLs.
