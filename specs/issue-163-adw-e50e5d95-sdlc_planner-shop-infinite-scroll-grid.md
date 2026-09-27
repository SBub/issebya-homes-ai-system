# Feature: Shop infinite scroll grid (useInfiniteQuery, keyset cursor, cached pages, list-only Suspense)

## Metadata

issue_number: `163`
adw_id: `e50e5d95`
issue_json: `{"number":163,"title":"Shop: infinite scrolling for the product grid with useInfiniteQuery, 6 per page, keyset cursor, cached pages, list-only Suspense with a card-sized skeleton","labels":["adw:hold"],"body":"(see GitHub issue #163; constraints restated in this plan)"}`

## Feature Description

`/shop` currently renders the whole product registry (`allProducts`, 6 sample entries) at once, as a fully static page. This feature turns the grid into an infinite list:

- A single server data function, `getProductsPage(cursor, limit)`, slices the registry with an opaque keyset cursor (`base64url("after:<slug>")`) and is cached with `"use cache"` + `cacheTag("shop-products")` + `cacheLife("days")`.
- A thin `GET /api/shop/products?cursor=&limit=` route validates the query with Zod and returns `{ items, nextCursor }` from that same function.
- On the client, TanStack Query v5 drives the list (suspense variant of the infinite query, same options as `useInfiniteQuery`), six products per page, with `staleTime`/`gcTime` of one hour.
- The first page is prefetched on the server through `getProductsPage` (not HTTP), streamed to the client via `HydrationBoundary` + `dehydrate`, so page one appears without a client round trip and without a double fetch.
- Only the list sits in `<Suspense>`, with a `ProductGridSkeleton` whose boxes have exactly the card's outer size, so there is no layout jump. Later pages append; a smaller skeleton shows only while `isFetchingNextPage`.
- An `IntersectionObserver` sentinel and a visible "Load more" button trigger the next page. A next-page error renders a retry line and never unmounts loaded items.
- PostHog event `shop_products_page_loaded { page_index, items }` fires for every successful page after the first.
- The sample registry grows from 6 to 15 entries (3 pages: 6, 6, 3), still flagged as sample data.

## User Story

As a visitor browsing the shop
I want to see the first six pieces straight away and more pieces appearing as I scroll
So that the page loads fast and I can keep browsing the whole catalogue without pagination clicks or layout jumps

## Problem Statement

The grid renders every product in one pass. It does not scale as the catalogue grows. There is no data endpoint or client data layer to load products incrementally, and no loading state sized to the cards. The owner wants incremental loading that stays cheap (cached server pages, since the catalogue rarely changes), keeps `/shop` in the static shell, and does not fetch page one twice.

## Solution Statement

Build it bottom-up, keeping each piece pure and testable at the cheapest layer:

1. **Pure pagination** (`src/lib/shop/pagination.ts`): `SHOP_PAGE_SIZE = 6`, the shared query key, the `ProductsPage` type, `encodeCursor`/`decodeCursor` (base64url of `after:<slug>`), and `selectPage(products, cursor, limit)`, which is the only code that slices the registry. Unit-tested in the node pool.
2. **Cached data function** (`src/lib/shop/pages.ts`): `getProductsPage(cursor, limit)` with `"use cache"`, `cacheTag("shop-products")`, `cacheLife("days")`, calling `selectPage(allProducts, …)`. One cache entry per `(cursor, limit)` argument pair, each storing its page's items and its own `nextCursor`.
3. **Route handler** (`src/app/api/shop/products/route.ts`): Zod-validates `limit` (int 1..24, default 6) and `cursor` (optional string), calls `getProductsPage`, returns JSON, and returns 400 on a bad query or an unknown/undecodable cursor.
4. **Client layer**: `@tanstack/react-query` added to `apps/website` only. A `ShopProviders` client component is mounted by a new `src/app/(main)/shop/layout.tsx`. `ProductList` (client) reads the query, renders `ProductCard`s, the sentinel, the Load more button and the retry line. `ProductGridSkeleton` mirrors the grid and card box.
5. **Server prefetch + streaming**: an async server component `ShopProducts` creates a per-request `QueryClient`, calls `prefetchInfiniteQuery` (not awaited) with `queryFn` → `getProductsPage`, and renders `<HydrationBoundary state={dehydrate(queryClient)}>` around `<ProductList />`. The shared query-client factory dehydrates pending queries, so the promise streams through RSC and the client's suspense infinite query picks it up instead of fetching.
6. **Page**: the `/shop` static shell (section + sell link) keeps its shape. Inside the `Products` section, `<Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}>` wraps `<ShopProducts />`.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md`: yarn-only, conventional commits, lefthook gates.
- `apps/website/AGENTS.md`: read the Next docs under `node_modules/next/dist/docs/` first. Zod at API boundaries, `next/image`, and which test layers gate (browser tests gate on push/CI, `e2e/` does not).
- `apps/website/ENGINEERING.md`: why pages render the way they do, and the test layers.
- `apps/website/app_docs/nextjs-patterns-guide.md`: route/layout/server component patterns.
- `apps/website/app_docs/data-fetching-client.md`: this feature is a deliberate, issue-mandated exception to "don't fetch from a Client Component". Keep the reasoning in the component comment.
- `apps/website/app_docs/component-patterns-guide.md`: new components (skeleton mirrors card box via data, not duplicated JSX logic).
- `apps/website/app_docs/zod-validation-guide.md`: query schema for the route.
- `apps/website/app_docs/import-patterns-guide.md`: destructured imports.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md`, `apps/website/app_docs/testing/e2e_example.md`: test formats.
- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md`: a new browser-suite dependency (`@tanstack/react-query`) must be listed in `optimizeDeps.include`, or cold CI runs die with "Vitest failed to find the runner".
- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md`: existing skeleton-in-Suspense precedent (non-interactive placeholder, same DOM box).
- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md`: product registry, card sizing rules.
- `apps/website/app_docs/feature-e9bc2126-shop-card-image-carousel.md`: card `<article>`/link structure, `a[href^="/shop/"]` doubling in tests, `posthog-js` mocking in browser tests.
- `apps/website/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`, `…/01-getting-started/08-caching.md` (non-deterministic ops / `Date.now()` section), `…/03-api-reference/04-functions/cacheLife.md`, `…/revalidateTag.md`, `…/01-getting-started/15-route-handlers.md`, `…/02-guides/streaming.md`: read before writing (docs live under the repo-root `node_modules/next/dist/docs/`).
- `apps/website/src/app/(main)/shop/page.tsx`: the page to restructure (static shell → Suspense → prefetch → list).
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: unchanged. The skeleton copies its outer box classes.
- `apps/website/src/app/(main)/shop/ui/ProductImageCarousel.tsx`: unchanged. Uses `posthog-js` (the pattern for the new event).
- `apps/website/src/lib/shop/products.ts`: extend the sample registry to 15 entries.
- `apps/website/src/lib/shop/schema.ts`: `Product` type (JSON-serialisable, safe to send over the wire).
- `apps/website/src/lib/shop/__tests__/products.unit.test.ts`: asserts "six sample products". Must be updated.
- `apps/website/src/lib/availability.ts`: existing `"use cache"`/`cacheTag`/`cacheLife` pattern.
- `apps/website/src/app/api/availability/route.ts`: existing route handler shape.
- `apps/website/src/app/api/ical/[room]/__tests__/route.unit.test.ts`, `apps/website/src/app/api/bookings/direct/__tests__/route.unit.test.ts`: route unit-test patterns, including `vi.mock("next/cache", …)`.
- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx`: renders `ShopIndexPage` in the browser and asserts the Products section is the first element. It must mock the new server prefetch component.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`: browser-test mocks for `next/link`, `next/image`, `posthog-js`.
- `apps/website/src/app/sitemap.ts`, `apps/website/src/app/(main)/shop/[slug]/page.tsx`: consume `allProducts`. They are untouched but pick up the new sample entries (more prerendered `/shop/[slug]` pages, more sitemap URLs).
- `apps/website/e2e/shop.integration.spec.ts`: first test asserts 6 articles and a link for **every** product. Must change to page one only, plus new infinite-scroll tests.
- `apps/website/vitest.config.ts`: add `@tanstack/react-query` to `optimizeDeps.include`.
- `apps/website/package.json`: new dependency.
- `knip.json`: website `entry` already covers new tests. No change expected, but run `yarn knip`.
- `docs/conditional-docs.md`: the document phase adds an entry for the feature doc.

### New Files

- `apps/website/src/lib/shop/pagination.ts`: `SHOP_PAGE_SIZE`, `SHOP_PRODUCTS_QUERY_KEY`, `ProductsPage` type, `encodeCursor`, `decodeCursor`, `UnknownCursorError`, `selectPage`.
- `apps/website/src/lib/shop/__tests__/pagination.unit.test.ts`
- `apps/website/src/lib/shop/pages.ts`: `getProductsPage` (`"use cache"`).
- `apps/website/src/lib/shop/query-client.ts`: `makeShopQueryClient()` shared by server prefetch and client provider (staleTime/gcTime 1h, dehydrate pending queries).
- `apps/website/src/app/api/shop/products/route.ts`
- `apps/website/src/app/api/shop/products/__tests__/route.unit.test.ts`
- `apps/website/src/app/(main)/shop/layout.tsx`: renders `<ShopProviders>{children}</ShopProviders>`.
- `apps/website/src/app/(main)/shop/ui/ShopProviders.tsx`: `"use client"`, `QueryClientProvider`.
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx`: async server component (prefetch + `HydrationBoundary`).
- `apps/website/src/app/(main)/shop/ui/ProductList.tsx`: `"use client"` infinite list.
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx`
- `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx`
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.browser.test.tsx`

## Implementation Plan

### Phase 1: Foundation

- Add `@tanstack/react-query` (v5 latest) to `apps/website` and to the browser project's `optimizeDeps.include`.
- Grow the sample registry to 15 entries.
- Write the pure pagination module (cursor codec + `selectPage`) with its unit tests.
- Write the cached `getProductsPage` and the shared `makeShopQueryClient`.

### Phase 2: Core Implementation

- Route handler `GET /api/shop/products` + unit test.
- `ProductGridSkeleton`, `ShopProviders`, `ProductList` (client), `ShopProducts` (server prefetch + `HydrationBoundary`).

### Phase 3: Integration

- `shop/layout.tsx` mounts `ShopProviders`. `shop/page.tsx` swaps the static `allProducts.map` for `Suspense` → `ShopProducts`.
- Update the tests that assumed 6 products or rendered the whole page in the browser.
- Extend the Playwright shop spec. Verify the build output keeps `/shop` in the static shell.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs this change depends on

- Read `apps/website/AGENTS.md`, then in the repo-root `node_modules/next/dist/docs/01-app/`: `03-api-reference/01-directives/use-cache.md`, `01-getting-started/08-caching.md` (especially "Working with non-deterministic operations"), `03-api-reference/04-functions/cacheLife.md`, `03-api-reference/04-functions/revalidateTag.md`, `01-getting-started/15-route-handlers.md`, `02-guides/streaming.md`.
- Read TanStack Query v5's "Advanced Server Rendering" guide, sections on prefetching in Server Components and **streaming with pending queries** (`shouldDehydrateQuery` including `query.state.status === "pending"`), and the `useSuspenseInfiniteQuery` / `prefetchInfiniteQuery` references (in `node_modules/@tanstack/query-core` / `react-query` type definitions after install).

### 2. Add the dependency

- `yarn workspace website add @tanstack/react-query` (v5, latest). Do not add it anywhere else. No devtools package.
- In `apps/website/vitest.config.ts`, add `"@tanstack/react-query"` to the browser project's `optimizeDeps.include` list (see `feature-cc081a8b-gate-browser-tests-in-ci.md`).

### 3. Extend the sample registry

- In `apps/website/src/lib/shop/products.ts`, extend `samples` with nine more entries (`Seven` … `Fifteen`, plausible EUR minor-unit amounts), total **15** (pages of 6, 6, 3). `sampleImages` already wraps `sample-0N.webp` via `% 6`, so no new images are needed.
- Update the header comment: "THESE FIFTEEN ENTRIES ARE SAMPLE DATA", plus one line saying the count exists so `/shop` shows at least three pages of `SHOP_PAGE_SIZE`.
- Update `src/lib/shop/__tests__/products.unit.test.ts`: `"holds the fifteen sample products"` → `toHaveLength(15)`. Other assertions (unique slugs, images exist, 2 or 3 images) keep passing.

### 4. Pure pagination module + unit tests

- Create `apps/website/src/lib/shop/pagination.ts`. It imports only the `Product` type, so it runs in the node pool and is safe to import from the client (it must not import `products.ts` or `next/cache`):
  - `export const SHOP_PAGE_SIZE = 6;`
  - `export const SHOP_PRODUCTS_QUERY_KEY = ["shop", "products", SHOP_PAGE_SIZE] as const;`
  - `export type ProductsPage = { items: Product[]; nextCursor: string | null };`
  - `export class UnknownCursorError extends Error {}` (named, so the route maps it to 400 without string-matching).
  - `encodeCursor(slug: string): string` → `base64url("after:" + slug)`. `decodeCursor(cursor: string): string` → slug, and it throws `UnknownCursorError` when the decoded text lacks the `after:` prefix or the slug is empty. Implement base64url with `btoa`/`atob` + `TextEncoder`/`TextDecoder` and the `+/=` → `-_` substitutions (works in node and browser), or `Buffer` if the module is only ever imported server-side. Pick one and note it in a comment.
  - `selectPage(products, cursor: string | null, limit: number): ProductsPage`: `cursor === null` → start at 0. Otherwise decode, `findIndex` by slug, throw `UnknownCursorError` if not found, start at `index + 1`. `items = products.slice(start, start + limit)`. `nextCursor = start + limit < products.length ? encodeCursor(items.at(-1).slug) : null`.
  - Comment: this is the only code that slices the registry. Keyset by slug, never an offset, because an offset shifts items if the list changes between loads.
- Create `apps/website/src/lib/shop/__tests__/pagination.unit.test.ts` over a synthetic 15-product fixture built with `toProduct` or plain objects:
  - first page (`null`, 6) returns products 0..5 and `nextCursor === encodeCursor(products[5].slug)`
  - second page from that cursor returns 6..11. The third returns 12..14 with `nextCursor: null`.
  - exact multiple (12 items, limit 6): second page has `nextCursor: null`, never a cursor to an empty page.
  - unknown slug cursor throws `UnknownCursorError`. Garbage (not base64url / missing `after:`) throws `UnknownCursorError`.
  - `decodeCursor(encodeCursor(slug)) === slug` for a few slugs. The encoded cursor does not contain the raw slug text (opaque) and matches `/^[A-Za-z0-9_-]+$/`.
  - empty registry → `{ items: [], nextCursor: null }`.
  - `SHOP_PRODUCTS_QUERY_KEY` equals `["shop", "products", 6]`.

### 5. Cached data function

- Create `apps/website/src/lib/shop/pages.ts`:
  ```ts
  export async function getProductsPage(
    cursor: string | null,
    limit: number,
  ): Promise<ProductsPage> {
    "use cache";
    cacheTag("shop-products");
    cacheLife("days");
    return selectPage(allProducts, cursor, limit);
  }
  ```
- The function comment must state: profile `cacheLife("days")`. One server cache entry per `(cursor, limit)` argument pair, each storing that page's items **and** the `nextCursor` computed for it. The cursor changing from page to page is data inside entries, not a drifting key. Invalidation is one `revalidateTag("shop-products")` if products ever change at runtime, and a deploy rebuilds anyway. An unknown cursor throws (`UnknownCursorError`), and a thrown error is not cached.

### 6. Shared QueryClient factory

- Create `apps/website/src/lib/shop/query-client.ts` exporting `makeShopQueryClient()`:
  - `defaultOptions.queries`: `staleTime: 60 * 60 * 1000`, `gcTime: 60 * 60 * 1000`.
  - `defaultOptions.dehydrate.shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) || q.state.status === "pending"` (TanStack's documented streaming pattern, which is what lets the server hand the not-yet-resolved page-one promise to the client).
  - Keep the hour as one named constant (`SHOP_QUERY_TTL_MS`) used for both.

### 7. Route handler + unit test

- Create `apps/website/src/app/api/shop/products/route.ts`:
  - Zod schema over `Object.fromEntries(searchParams)`: `limit: z.coerce.number().int().min(1).max(24).default(SHOP_PAGE_SIZE)`, `cursor: z.string().min(1).optional()`. An empty `cursor=` is treated as absent (preprocess `""` → `undefined`).
  - Invalid query → `400 { error }`. Calls `getProductsPage(cursor ?? null, limit)`. `UnknownCursorError` → `400 { error: "Unknown cursor" }`. Any other error → `captureException` + 500 (same shape as `api/availability/route.ts`). Success → `NextResponse.json({ items, nextCursor })`.
- Create `apps/website/src/app/api/shop/products/__tests__/route.unit.test.ts` (node pool). Mock `next/cache` (`cacheTag`/`cacheLife` no-ops, as in `api/bookings/direct/__tests__/route.unit.test.ts`) and `@sentry/nextjs`, and use the real registry:
  - no params → 200, `items.length === 6`, `items[0].slug === allProducts[0].slug`, `nextCursor` a string.
  - `limit=30` → 400. `limit=0` → 400. `limit=abc` → 400.
  - `cursor=<encodeCursor("does-not-exist")>` → 400. `cursor=%%%garbage` → 400.
  - following `nextCursor` twice from the first page reaches the last page, which has `nextCursor: null` and `15 - 12 = 3` items.
  - response shape has exactly the keys `items` and `nextCursor`.

### 8. ProductGridSkeleton

- Create `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx` (server-safe, no hooks): props `{ count: number }`. Renders a fragment containing:
  - `<p role="status" className="sr-only">Loading products</p>`
  - `<ul aria-hidden="true" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">` with `count` `<li>`s, each holding a `<div>` with the card's outer box classes `flex flex-col h-full aspect-[3/5] md:max-lg:aspect-auto md:max-lg:min-h-[26rem] bg-shop-card p-3.5`, plus an inner photo-area block `basis-[58%]` with a muted fill (`animate-pulse` gated by `motion-safe:`). No interactive elements, no text.
- Export the grid class string as a shared constant (`PRODUCT_GRID_CLASS` in `ProductGridSkeleton.tsx` or a tiny `grid.ts`) and use it in `ProductList` too, so the two `<ul>`s cannot drift. Likewise export the card box class from `ProductCard.tsx` (`PRODUCT_CARD_BOX_CLASS`) and use it in both `ProductCard`'s `<article>` and the skeleton box. This is a no-op for `ProductCard`'s rendered output, so it does not change the card.

### 9. ShopProviders and layout

- Create `apps/website/src/app/(main)/shop/ui/ShopProviders.tsx`: `"use client"`, `const [client] = useState(makeShopQueryClient)`, `<QueryClientProvider client={client}>{children}</QueryClientProvider>`.
- Create `apps/website/src/app/(main)/shop/layout.tsx`: default export rendering `<ShopProviders>{children}</ShopProviders>`. No data access, no request APIs, so `/shop/[slug]` and `/shop/sell` stay prerendered. Do not touch the root or `(main)` layout.

### 10. ProductList (client)

- Create `apps/website/src/app/(main)/shop/ui/ProductList.tsx`, `"use client"`:
  - `useSuspenseInfiniteQuery({ queryKey: SHOP_PRODUCTS_QUERY_KEY, initialPageParam: null as string | null, getNextPageParam: (last) => last.nextCursor, queryFn: ({ pageParam, signal }) => fetchProductsPage(pageParam, signal) })`. This is the suspense variant of `useInfiniteQuery`, with identical options. It is required so that the hydrated **pending** page-one promise suspends into the list's `<Suspense>` skeleton instead of rendering an empty pending state. The comment should explain why.
  - `fetchProductsPage` builds a relative URL `/api/shop/products?limit=${SHOP_PAGE_SIZE}` plus `&cursor=…` when not null (relative, so no base-URL construction; see `dynamic-url-construction.md`), throws on `!res.ok`, and returns `ProductsPage`.
  - Flatten `data.pages.flatMap(p => p.items)`. Render `<ul className={PRODUCT_GRID_CLASS}>` with `<li key={slug}><ProductCard product={p} /></li>`.
  - Next-page skeleton: when `isFetchingNextPage`, render `<ProductGridSkeleton count={…} />` below the list. Count is `SHOP_PAGE_SIZE`, or a smaller number that fills the remaining row. Keep it simple: `Math.min(SHOP_PAGE_SIZE, 3)`.
  - Sentinel: a `<div aria-hidden data-testid="shop-products-sentinel" className="h-px">` after the list. Attach an `IntersectionObserver` through a **callback ref** (React 19 callback refs may return a cleanup), with `rootMargin: "400px 0px"`. When `entry.isIntersecting && hasNextPage && !isFetchingNextPage`, call `loadMore()`. Read the latest flags through a ref so the observer is not recreated on every render (see the `no-unnecessary-effects` skill).
  - `loadMore()`: `const result = await fetchNextPage(); if (!result.isError) { const pages = result.data?.pages ?? []; posthog.capture("shop_products_page_loaded", { page_index: pages.length - 1, items: pages.at(-1)?.items.length ?? 0 }); }`. The page-one prefetch never passes through `loadMore`, so it is never reported. Background refetches are not reported either.
  - "Load more" `<button type="button">` after the grid, visible text "Load more", rendered only when `hasNextPage`, `disabled` while `isFetchingNextPage`, `onClick={loadMore}`.
  - Next-page error (`isFetchNextPageError`): render `<p role="alert">` "Couldn't load more products." with a "Try again" button calling `loadMore`. Loaded items stay rendered. For a page-one failure, suspense queries throw to the nearest error boundary. That is out of scope beyond Next's default.
  - Do not change `ProductCard`. No position/numeral props (the issue text mentions "roman numeral positions", but `ProductCard` has none today and `ProductCard.browser.test.tsx` asserts that no numeral renders. Keep it that way and note it in the PR).

### 11. ShopProducts (server prefetch + HydrationBoundary)

- Create `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` (server component, no directive):
  ```tsx
  export function ShopProducts() {
    const queryClient = makeShopQueryClient();
    void queryClient.prefetchInfiniteQuery({
      queryKey: SHOP_PRODUCTS_QUERY_KEY,
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }) => getProductsPage(pageParam, SHOP_PAGE_SIZE),
    });
    return (
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ProductList />
      </HydrationBoundary>
    );
  }
  ```
  The prefetch is not awaited. The dehydrated pending query carries its promise through RSC. Do not add a `use(promise)` + `initialData` path.
- **Cache Components gotcha (verify with the build):** `QueryClient` reads `Date.now()` (e.g. `dataUpdatedAt`). Under `cacheComponents: true`, reading the current time in a server component during prerender can fail the build (`next-prerender-current-time`). If `next build` reports it for `/shop`, the fix, in order of preference, is:
  1. Make `ShopProducts` `async` and `await getProductsPage(null, SHOP_PAGE_SIZE)` before building the client, then `prefetchInfiniteQuery` with `queryFn: () => thatPage` so the time read comes after cached IO. The awaited call is the same `"use cache"` entry, so there is no second slice.
  2. Otherwise, follow what the Next docs prescribe for this case.

  Never use `connection()`, which would make `/shop` dynamic. Record which variant shipped, and why, in the component comment and the PR.

### 12. Wire the page

- Edit `apps/website/src/app/(main)/shop/page.tsx`:
  - Keep `metadata`, the outer `<div>`, `<section aria-label="Products" className="bg-shop-ground px-4 py-10 md:px-12 md:py-16 min-h-screen">` as the **first** child, and the sell-link `<p>` unchanged.
  - Replace the `<ul>…allProducts.map…</ul>` with `<Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}><ShopProducts /></Suspense>`.
  - Drop the `allProducts` and `ProductCard` imports. Update the "Reads nothing from the request" comment: the shell is static, and the list is the streamed/cached hole.

### 13. Fix existing tests affected by the change

- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx`: add `vi.mock("./shop/ui/ShopProducts", () => ({ ShopProducts: () => null }))`. The page shell (section is first child, no h1) is what is under test, and the real component pulls in `next/cache` and the server registry. Both existing `/shop` assertions must still pass.
- `apps/website/e2e/shop.integration.spec.ts` first test: rename to "index shows the first six product cards linking to /shop/…". Assert `toHaveCount(SHOP_PAGE_SIZE)` and loop over `allProducts.slice(0, SHOP_PAGE_SIZE)` only.

### 14. Browser tests for the list and skeleton

- Create `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx` (component-scoped). Mock `next/link`, `next/image`, `posthog-js` (`capture` spy) as `ProductCard.browser.test.tsx` does:
  - Fixture: 15 plain `Product` objects, and pages built with the real `selectPage`.
  - Helper `renderHydrated()` builds a "server" `QueryClient` and `setQueryData(SHOP_PRODUCTS_QUERY_KEY, { pages: [page1], pageParams: [null] })`, dehydrates it, and renders `<QueryClientProvider client={makeShopQueryClient()}><HydrationBoundary state={dehydrated}><Suspense fallback={null}><ProductList/></Suspense></HydrationBoundary></QueryClientProvider>`.
  - Stub `fetch` with `vi.spyOn(window, "fetch")` returning `Response.json(selectPage(fixture, cursor, limit))` parsed from the request URL.
  - Stub `IntersectionObserver` with a test double that records instances and exposes `trigger(isIntersecting)`.
  - Tests:
    1. first page renders 6 articles from hydrated state and `fetch` was **not** called. The capture spy was not called.
    2. triggering the sentinel intersection → exactly one `fetch` call (URL contains `cursor=` of `page1.nextCursor` and `limit=6`) → 12 articles. `capture` called once with `("shop_products_page_loaded", { page_index: 1, items: 6 })`.
    3. clicking "Load more" does the same (12 articles, one fetch).
    4. after loading the last page (15 articles), the "Load more" button is gone, and triggering the sentinel again makes no further fetch (`hasNextPage: false` hides/disarms both).
    5. a next-page fetch that returns 500 renders the retry alert while the 6 loaded articles stay. "Try again" then succeeds and gives 12.
    6. while the next page is in flight (fetch held on a deferred promise), the `role="status"` "Loading products" skeleton is present below the loaded cards.
  - **Negative check (do once, then revert):** remove the `HydrationBoundary` wrapper from `renderHydrated` and confirm test 1 fails because `fetch` is called for page one. Restore it, and state in the PR that this was tried and reverted.
- Create `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.browser.test.tsx`:
  - renders `count` `<li>` boxes inside an `aria-hidden` `<ul>` whose class list equals `PRODUCT_GRID_CLASS`. Each box carries `aspect-[3/5]`, `md:max-lg:aspect-auto` and `md:max-lg:min-h-[26rem]`, and exactly one `role="status"` with "Loading products".
  - at a desktop viewport (`page.viewport(1280, 900)`), a skeleton box's `getBoundingClientRect()` height equals a real `ProductCard`'s height rendered in the same grid (±1px). This proves no layout shift when cards replace the skeleton.

### 15. Playwright spec

- Extend `apps/website/e2e/shop.integration.spec.ts` (modelled on the existing tests. The catalogue reads no database, so no fixtures or cleanup are needed):
  - "scrolling loads the next pages of products": `goto("/shop")`, expect 6 articles, `page.getByTestId("shop-products-sentinel").scrollIntoViewIfNeeded()` → expect 12, repeat → expect `allProducts.length` (15). The "Load more" button is then hidden, and the last product's name link has `href` `/shop/<slug>`.
  - "Load more button loads the next page": expect 6, click `getByRole("button", { name: "Load more" })` → expect 12.
  - "first page is not fetched from the API": record `page.on("request")` for `/api/shop/products`, `goto("/shop")`, wait for 6 articles. Expect zero requests before any scroll.
  - "the products API pages with an opaque cursor": `request.get("/api/shop/products")` → 200 with 6 items. Then `?limit=30` → 400.

### 16. Verify the build and static shell

- `yarn turbo run build --filter=./apps/website` and paste the route table in the PR: `/shop` shows as `◐`/`○` (static shell with the list as the streamed hole, the Partial Prerender marker under Cache Components), `/api/shop/products` is `ƒ`, and `/shop/[slug]` stays `●` with 15 params. If `/shop` turned dynamic, or the build errors on current time, apply step 11's gotcha fix.

### 17. Run the Validation Commands

- Run every command in `Validation Commands` below and fix anything red.

## Testing Strategy

### Unit Tests

- `src/lib/shop/__tests__/pagination.unit.test.ts`: cursor codec round-trip and opacity, `selectPage` first/middle/last page, exact-multiple boundary, unknown and garbage cursor, empty registry, query key shape.
- `src/app/api/shop/products/__tests__/route.unit.test.ts`: default limit 6, limit bounds (0, 30, non-numeric → 400), unknown and garbage cursor → 400, cursor-following to the last page with `nextCursor: null`, exact response shape.
- `src/lib/shop/__tests__/products.unit.test.ts` (updated): registry length 15, and every new sample image path exists.

### Test Coverage

- `src/lib/shop/__tests__/pagination.unit.test.ts` (`*.unit.test.ts`): catches off-by-one keyset slicing, a cursor to an empty trailing page, a non-opaque cursor, and silent acceptance of unknown cursors. The module does not exist today, so the test fails without the feature.
- `src/app/api/shop/products/__tests__/route.unit.test.ts` (`*.unit.test.ts`): catches a missing/incorrect Zod boundary (limit > 24 accepted, bad cursor → 500 instead of 400) and a wrong JSON shape. There is no endpoint today.
- `src/app/(main)/shop/ui/ProductList.browser.test.tsx` (`*.browser.test.tsx`): catches double-fetching page one (the HydrationBoundary negative check proves this), sentinel/button not loading or loading twice, controls not disappearing at the end, loaded items unmounting on a next-page error, and the analytics event missing or firing for page one.
- `src/app/(main)/shop/ui/ProductGridSkeleton.browser.test.tsx` (`*.browser.test.tsx`): catches skeleton/card box drift, which causes a layout jump when cards arrive, and a missing accessible loading status.
- `src/app/(main)/index-pages-no-title-heading.browser.test.tsx` (updated): keeps proving the `/shop` shell still opens on the Products section with no h1 after the restructure.
- `apps/website/e2e/shop.integration.spec.ts` (`*.spec.ts`, extended): the real journey across server prefetch, hydration, route handler and cache. Six cards first with no API request, scroll to 12 then 15, button works. Only the running app can prove the RSC streaming + hydration handoff end to end. The existing spec would fail (6 → 15 products, "every product" loop) without the matching update.
- Build route table (step 16): not a test file, but the required proof that `/shop` stays prerendered.

### Edge Cases

- Registry length an exact multiple of the page size: the last full page must return `nextCursor: null`, not a cursor to an empty page.
- Empty registry: `{ items: [], nextCursor: null }`, and the list renders no items and no button.
- Cursor for a slug that was removed between loads (deploy mid-session): 400 from the endpoint. The client shows the retry line and keeps loaded items.
- Garbage / non-base64url cursor, `cursor=` empty string, `limit` 0 / 25 / non-numeric / float.
- Sentinel intersecting while a fetch is in flight: no second concurrent fetch. Sentinel re-entering after the last page: no fetch.
- Rapid double-click on Load more: the button is disabled while fetching, and TanStack dedupes too.
- Navigating `/shop` → `/shop/[slug]` → back within the hour: cached pages reused from the layout-scoped client, with no refetch of page one.
- `prefers-reduced-motion`: the skeleton pulse is `motion-safe:` only.
- Mobile 390px single column vs 1280px three columns: skeleton boxes match card height at both.

## Acceptance Criteria

- `getProductsPage(cursor, limit)` exists in `src/lib/shop/pages.ts` with `"use cache"`, `cacheTag("shop-products")`, `cacheLife("days")`, and a comment explaining the per-`(cursor, limit)` entries and `revalidateTag("shop-products")` invalidation. `selectPage` is the only code slicing the registry.
- Cursors are `base64url("after:<slug>")`. There is no offset anywhere. An unknown cursor throws in the function and returns 400 from `GET /api/shop/products`.
- `GET /api/shop/products` validates with Zod (`limit` 1..24 default 6, `cursor` optional) and returns `{ items, nextCursor }`.
- `SHOP_PAGE_SIZE = 6` is the single constant used by the server prefetch, the client query/URL and the skeleton count.
- `@tanstack/react-query` v5 is a dependency of `apps/website` only. `QueryClientProvider` lives in `ShopProviders`, rendered by `src/app/(main)/shop/layout.tsx`. The query uses key `["shop","products",6]`, `initialPageParam: null`, `getNextPageParam: last => last.nextCursor`, and staleTime/gcTime of 1h.
- Page one is prefetched on the server via `prefetchInfiniteQuery` → `getProductsPage` inside `HydrationBoundary`, with no client fetch for page one (browser test + e2e network assertion). There is no `use(promise)`/`initialData` path.
- Only the list is inside `<Suspense>`, with a `ProductGridSkeleton` of 6 card-sized boxes (`aria-hidden`, plus one `role="status"` "Loading products"). The heading-free shell and the `/shop/sell` link line are unchanged.
- The sentinel and the "Load more" button each load exactly one next page. Both are gone when `hasNextPage` is false. A next-page error shows a retry line and keeps loaded items.
- `ProductCard` renders exactly as before.
- `shop_products_page_loaded { page_index, items }` is captured for each successful page after the first, never for page one.
- The registry holds 15 sample entries (3 pages), marked as sample data.
- Build output shows `/shop` prerendered (static shell with the list as the hole), and `/shop/[slug]` still `●`.
- All validation commands are green. Existing shop, wishlist and seller e2e specs pass on the run's port.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and (chromium) browser tests pass, including the new pagination, route, ProductList and skeleton tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds. Inspect the route table: `/shop` is prerendered with a dynamic hole, `/api/shop/products` is `ƒ`, `/shop/[slug]` is unchanged (`●`)

## Notes

- **New dependency:** `@tanstack/react-query` (v5, latest) via `yarn workspace website add @tanstack/react-query`. It is also added to `optimizeDeps.include` in `vitest.config.ts`, which is mandatory for cold CI browser runs.
- **Suspense variant:** the issue says `useInfiniteQuery`. The plan uses `useSuspenseInfiniteQuery`, the same API with the same options, because the streamed pending page-one query must suspend into the list's `<Suspense>` skeleton. With plain `useInfiniteQuery`, the list would render a non-suspending pending state, and the Suspense fallback would never be the thing the visitor sees. Call this out in the PR.
- **Roman numerals:** the issue mentions position numerals continuing across pages. `ProductCard` renders none today, and its browser test asserts that. The card stays unchanged, so there is nothing to continue. Mention this in the PR.
- **Static shell:** with `cacheLife("days")` the first page is cacheable at build time, so Next may fill it into the prerendered HTML rather than stream it on each request. Either way `/shop` stays in the static shell, which is the contract. The `Date.now()`-during-prerender gotcha is described in step 11.
- **`data-fetching-client.md` exception:** this is an intentional, issue-mandated client fetch for pages 2+ only. Page one still comes from the server.
- **Layout scope:** `ShopProviders` wraps `/shop/[slug]` and `/shop/sell` as well. That is harmless (no queries there) and keeps the client cache alive across shop navigation.
- The issue carries `adw:hold`. The owner reviews the Vercel preview (throttled skeleton, pages 2–3 on scroll, network tab, 390 and 1280 px screenshots) before removing the label. Those manual checks are hers. The PR should paste the build route table and describe the negative HydrationBoundary check.
- Out of scope: search/filters/sorting, database-backed products, card design changes, `/shop/[slug]`, a root-level React Query provider.
- No browser surface outside `apps/website` is touched. No other workspace needs changes. No DB, no migrations, no env vars.
