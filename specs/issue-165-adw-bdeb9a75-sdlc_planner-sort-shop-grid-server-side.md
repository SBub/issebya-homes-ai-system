# Feature: Sort the /shop grid on the server, newest first, with a (date, slug) keyset cursor

## Metadata

issue_number: `165`
adw_id: `bdeb9a75`
issue_json: `{"number":165,"title":"Shop: sort the product grid on the server (newest first by default) with the cursor anchored to (date, slug) — follow-up to #163"}`

## Feature Description

The `/shop` grid is paged by #163 (open as PR #164, branch
`feat/issue-163-adw-e50e5d95-shop-infinite-scroll-grid`): a keyset cursor
`after:<slug>` walks the registry in array order, page one is prefetched on the
server into a hydrated TanStack Query cache, and pages 2+ come from
`GET /api/shop/products`.

This feature gives every product a `createdAt` calendar day and makes the grid's
order a **server parameter**, `sort = newest | oldest` (default `newest`). The
server sorts inside the same function that pages, and the cursor becomes a
bookmark of the last item shown _in that order_: `{ sort, createdAt, slug }`.
Selection is "strictly after the bookmark tuple", so paging stays correct even
when products are added or removed between two page loads. A small sort control
above the grid (`Newest first` / `Oldest first`) switches the order and keeps it
in the URL (`/shop?sort=oldest`); the default adds nothing to the URL.

## User Story

As a visitor browsing the shop
I want to see the newest pieces first, and be able to flip to the oldest
So that I find what is fresh without scrolling past everything else, and a link I share opens in the same order

## Problem Statement

The grid order is the registry's array order, which the owner has to maintain by
hand and which says nothing about freshness. Sorting in the browser is not an
option: the cursor is a bookmark to "the last item I showed you, in this order",
so if the browser reordered items and asked for "after X", the server, paging in
its own order, would return the wrong neighbours. And the current slug-only
cursor 400s the moment its product leaves the registry.

## Solution Statement

- `productSchema` gains a required `createdAt: "yyyy-MM-dd"` string. Calendar days
  stay strings end to end: `"yyyy-MM-dd"` compares lexicographically in
  chronological order, so sorting and keyset comparison need no `Date` at all
  (no `new Date("…")`, no inline parsing, per `apps/website/AGENTS.md`).
- `pagination.ts` owns the whole ordering contract, purely:
  - `SHOP_SORTS = ["newest", "oldest"] as const`, `shopSortSchema = z.enum(SHOP_SORTS)`,
    `type ShopSort`, `DEFAULT_SHOP_SORT = "newest"`.
  - One comparator. `newest`: `createdAt` descending, then `slug` ascending.
    `oldest` is the exact negation (`createdAt` ascending, `slug` descending), so
    "Oldest first" is literally the reverse of "Newest first". Slug comparison is
    **plain code-point comparison** (`a < b ? -1 : a > b ? 1 : 0`), not
    `localeCompare`: slugs are `[a-z0-9-]` so the two agree today, and code-point
    order can never drift with the runtime's ICU data. Slug is the tie-breaker
    because it is unique (`assertUniqueProductSlugs`).
  - `sortProducts(products, sort)` returns a new sorted array (never mutates).
  - Cursor = `base64url(JSON.stringify({ sort, createdAt, slug }))`, still opaque,
    still base64url via the existing `toBase64Url`/`fromBase64Url`. Decoding
    validates the JSON with a Zod schema; anything malformed is
    `UnknownCursorError`. `decodeCursor(cursor, sort)` also throws
    `CursorSortMismatchError` when the bookmark's `sort` differs from the
    request's (a bookmark from a different shelf).
  - `selectPage(products, cursor, limit, sort)` sorts, then keeps the items that
    compare strictly after the bookmark tuple, takes `limit`, and hands out
    `nextCursor` only if more remain. The bookmarked slug no longer has to exist:
    a removed product just means "continue after where it was".
- `getProductsPage(cursor, limit, sort)` keeps `"use cache"`, tag `shop-products`,
  `cacheLife("days")`: one entry per `(cursor, limit, sort)`. Sort must be part of
  the key because page one (`cursor = null`) is a different list per sort.
- The endpoint accepts `sort` (Zod enum, default `newest`, invalid value = 400),
  checks the cursor against it **outside** the cache (same reason as #163: an
  error thrown in a `"use cache"` scope loses its class), and returns 400 for a
  garbage cursor or a sort mismatch.
- The query key becomes `shopProductsQueryKey(sort)` =
  `["shop", "products", SHOP_PAGE_SIZE, sort]`, used by both the server prefetch
  and `ProductList`. A new sort is a new key, so React Query starts at page one on
  its own; no manual cache clearing.
- The page passes its `searchParams` **promise** into the Suspense hole
  (`ShopProducts`), which awaits it, parses `sort` leniently
  (`shopSortSchema.catch(DEFAULT_SHOP_SORT)`: a hand-typed `?sort=foo` shows the
  default, it doesn't error), prefetches page one for that sort through a cached
  `getFirstPageState(sort)`, and renders `ShopSortControl` + `ProductList sort={sort}`.
  The page component itself never awaits the request, so the shell (section,
  heading area, sell link) stays static and only the list is the dynamic hole.
- `ShopSortControl` is a client component: a native `<select>` in the site's
  uppercase letter-spaced label style, value driven by `useOptimistic(sort)` so
  it shows the new choice immediately while `router.replace` (inside
  `startTransition`) fetches the new server render. `newest` replaces to
  `/shop`, `oldest` to `/shop?sort=oldest`, both with `{ scroll: false }`. It
  captures `shop_sort_changed { sort }`.

## Relevant Files

Use these files to implement the feature:

Branch prerequisite: every `apps/website/src/**/shop` and `api/shop` file below
that is described as "from #163" does **not** exist on this branch yet. Step 1
brings them in.

- `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook).
- `apps/website/AGENTS.md` - calendar days are strings (`toCalendarDay`/`fromCalendarDay`), Zod at API boundaries, which test layers gate.
- `docs/conditional-docs.md` - doc index; the #163 entry points at its feature doc.
- `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` (from #163) - why the cursor is checked outside the cache, why page one is dehydrated inside `"use cache"`, why `refetchOnMount: false`, why `useSuspenseInfiniteQuery`.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Server/Client split, reading `searchParams`.
- `apps/website/app_docs/data-fetching-client.md` - #163's deliberate exception (pages 2+ fetched from a Client Component) still applies.
- `apps/website/app_docs/zod-validation-guide.md` - enum + default on the endpoint, `.catch` on the page.
- `apps/website/app_docs/component-patterns-guide.md` - new `ShopSortControl` component.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md`, `apps/website/app_docs/testing/e2e_example.md` - test formats.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` and `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` - `searchParams` is a Promise; awaiting it inside `<Suspense>` keeps the rest of the page in the static shell under `cacheComponents: true`. Read before touching `page.tsx` (the workspace AGENTS.md requires reading Next docs first).
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md` - arguments are part of the cache key.
- `apps/website/src/lib/date-utils.ts` - `toCalendarDay`/`fromCalendarDay`, used only if the schema needs a real-day refine (see Step 2).
- `apps/website/src/lib/shop/schema.ts` - add `createdAt` to `productSchema`.
- `apps/website/src/lib/shop/products.ts` (changed by #163 to fifteen samples) - add a `createdAt` per sample.
- `apps/website/src/lib/shop/pagination.ts` (from #163) - sort enum, comparator, `sortProducts`, new cursor codec, `selectPage(…, sort)`, query-key function.
- `apps/website/src/lib/shop/pages.ts` (from #163) - `getProductsPage(cursor, limit, sort)`.
- `apps/website/src/app/api/shop/products/route.ts` (from #163) - `sort` param, mismatch → 400.
- `apps/website/src/app/(main)/shop/page.tsx` (changed by #163) - pass `searchParams` into the hole; update the "reads nothing from the request" comment.
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` (from #163) - await sort, `getFirstPageState(sort)`, render the control.
- `apps/website/src/app/(main)/shop/ui/ProductList.tsx` (from #163) - `sort` prop, key, `sort` query param.
- `apps/website/src/lib/shop/query-client.ts`, `apps/website/src/app/(main)/shop/ui/ShopProviders.tsx`, `apps/website/src/app/(main)/shop/layout.tsx` (from #163) - unchanged, read for context.
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx` and `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` - the `uppercase tracking-[0.2em] text-xs` label style to copy.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.browser.test.tsx` - how the repo mocks `next/navigation` in a browser test.
- Tests that build `Product` literals and must gain `createdAt` to typecheck: `apps/website/src/lib/shop/__tests__/pagination.unit.test.ts`, `apps/website/src/lib/shop/__tests__/schema.unit.test.ts`, `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`, `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.browser.test.tsx`, `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx`.
- `apps/website/src/lib/shop/__tests__/products.unit.test.ts` - registry guarantees.
- `apps/website/src/app/api/shop/products/__tests__/route.unit.test.ts` (from #163) - endpoint tests.
- `apps/website/e2e/shop.integration.spec.ts` - existing shop journeys that assume registry order (`allProducts.slice(0, 6)`, `allProducts[0]`, `allProducts.at(-1)`), plus the new sort journey.
- `apps/website/src/app/sitemap.ts` and `apps/website/src/app/(main)/shop/[slug]/page.tsx` - must stay untouched (they iterate/look up `allProducts`, order-independent).

### New Files

- `apps/website/src/app/(main)/shop/ui/ShopSortControl.tsx` - client sort `<select>`, URL update, analytics.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.browser.test.tsx` - URL + analytics behaviour of the control.

## Implementation Plan

### Phase 1: Foundation

Bring #163 into this branch, then add `createdAt` to the schema and registry, and
update every `Product` literal in tests so the tree typechecks again.

### Phase 2: Core Implementation

Rewrite `pagination.ts` around the sort: enum, comparator, `sortProducts`,
tuple cursor with sort check, `selectPage(…, sort)`, `shopProductsQueryKey(sort)`.
Thread `sort` through `getProductsPage` and the endpoint. All pure logic is
covered by unit tests, including the negative tie-breaker check.

### Phase 3: Integration

Page → `ShopProducts` → `ProductList` receive `sort`; add `ShopSortControl`;
extend the browser tests and the Playwright spec; confirm the build still shows
`/shop` as a static shell with the list as the dynamic hole.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Base the branch on #163

- `git fetch origin`. If PR #164 (`feat/issue-163-adw-e50e5d95-shop-infinite-scroll-grid`) is still open, `git merge --no-edit origin/feat/issue-163-adw-e50e5d95-shop-infinite-scroll-grid` into this branch. If it has merged, `git merge --no-edit origin/develop` instead. Merge, don't rebase (the branch is shared with the ADW pipeline).
- Run `yarn install` (#163 adds `@tanstack/react-query` to `apps/website/package.json` and `yarn.lock`).
- Confirm `apps/website/src/lib/shop/pagination.ts`, `pages.ts`, `api/shop/products/route.ts`, `ShopProducts.tsx`, `ProductList.tsx` now exist. Do not proceed otherwise.
- Read `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` and the Next docs listed in Relevant Files.

### 2. Schema: required `createdAt`

- In `schema.ts`, add to `productSchema`: `createdAt: z.iso.date({ error: "Product createdAt must be a calendar day (yyyy-MM-dd)" })` with a comment that it is a calendar-day string, compared as a string, never parsed with `new Date`.
- First write the schema tests (below). If `z.iso.date()` accepts `"2026-02-30"`, add a `.refine((day) => toCalendarDay(fromCalendarDay(day)) === day, …)` using `@/lib/date-utils` (the one sanctioned conversion) and update the schema module's header comment, which currently says it imports only `zod`; `date-utils` is still node-pool safe.
- `schema.unit.test.ts`: add `createdAt` to the valid fixture; add cases: missing `createdAt` rejected; `"2026-9-1"`, `"2026-09-01T00:00:00Z"`, `"01-09-2026"`, `"2026-02-30"` rejected; `"2024-02-29"` accepted.

### 3. Registry: a date on every sample

- In `products.ts`, add `createdAt` to each entry of `samples` and pass it through to `toProduct`. Use exactly these dates, which are distinct except for one shared day that straddles the page-one/page-two boundary in `newest` order, and deliberately not in array order (so a passing grid proves the server sorts):

  | word     | createdAt  |
  | -------- | ---------- |
  | One      | 2026-03-02 |
  | Two      | 2026-05-03 |
  | Three    | 2026-01-20 |
  | Four     | 2026-06-30 |
  | Five     | 2026-04-11 |
  | Six      | 2026-02-14 |
  | Seven    | 2026-05-03 |
  | Eight    | 2026-07-22 |
  | Nine     | 2026-02-28 |
  | Ten      | 2026-03-27 |
  | Eleven   | 2026-08-09 |
  | Twelve   | 2026-01-05 |
  | Thirteen | 2026-05-03 |
  | Fourteen | 2026-09-01 |
  | Fifteen  | 2026-06-12 |

  Resulting `newest` order: fourteen, eleven, eight, four, fifteen, **seven** | **thirteen, two**, five, ten, one, nine | six, three, twelve. The three `2026-05-03` items are split across the page boundary, ordered by slug (`seven` < `thirteen` < `two`). `oldest` is the exact reverse.

- Update the registry doc comment: order in the file no longer matters for the grid; `/shop` sorts by `createdAt` (then slug) on the server.
- `products.unit.test.ts`: add "at least two products share a createdAt" (guards the sample data that exercises the tie-breaker).
- Add `createdAt` to every `Product` literal in the tests listed under Relevant Files. In `pagination.unit.test.ts` and `ProductList.browser.test.tsx`, the `product(n)` fixtures get a `createdAt` parameter (see Step 4).

### 4. `pagination.ts`: sort, comparator, tuple cursor, `selectPage`

- Keep the header rule: imports only `zod` and the `Product` type; never `products.ts` or `next/cache` (it is imported from a Client Component).
- Add `SHOP_SORTS`, `shopSortSchema`, `type ShopSort`, `DEFAULT_SHOP_SORT`.
- Replace `SHOP_PRODUCTS_QUERY_KEY` with `shopProductsQueryKey(sort: ShopSort)` returning `["shop", "products", SHOP_PAGE_SIZE, sort] as const`. Remove the constant (knip will flag it otherwise).
- `type SortKey = Pick<Product, "createdAt" | "slug">`; `compareProducts(a: SortKey, b: SortKey, sort: ShopSort): number` — newest: `b.createdAt` vs `a.createdAt`, then `a.slug` vs `b.slug`, both by code point; oldest: `-newest`. Comment why code point, why slug, why string compare of `yyyy-MM-dd` is chronological.
- `export function sortProducts(products: readonly Product[], sort: ShopSort): Product[]` → `[...products].sort(...)`.
- Cursor: `type CursorBookmark = { sort: ShopSort; createdAt: string; slug: string }`, validated on decode by a local Zod object (`sort: shopSortSchema`, `createdAt` same calendar-day check as the product schema — reuse, don't duplicate: export a `calendarDaySchema` from `schema.ts` and use it in both, `slug: z.string().min(1)`). `encodeCursor(bookmark)` = `toBase64Url(JSON.stringify(bookmark))`. `decodeCursor(cursor, sort)`: base64 or JSON failure or schema failure → `UnknownCursorError`; `bookmark.sort !== sort` → `CursorSortMismatchError` (new class, own `name`). Drop the `after:` prefix.
- Remove `cursorStart`; the route calls `decodeCursor(cursor, sort)` for its outside-the-cache check instead.
- `selectPage(products, cursor, limit, sort)`: `sorted = sortProducts(products, sort)`; `start = cursor === null ? 0 : sorted.findIndex(p => compareProducts(p, bookmark, sort) > 0)` (−1 → `sorted.length`, i.e. an empty page); `items = sorted.slice(start, start + limit)`; `nextCursor` = encoded `{ sort, createdAt, slug }` of the last item when `start + limit < sorted.length`, else `null`. Rewrite the doc comment: keyset by `(createdAt, slug)`, strictly-after, so inserts before the bookmark and removal of the bookmarked item neither duplicate nor skip.
- Rewrite `pagination.unit.test.ts` (fixture: `product(n, createdAt)`):
  - `sortProducts` newest: dates descending, shared date ordered by slug ascending; oldest is the exact reverse; input array is not mutated.
  - `selectPage` newest and oldest: page one, then following `nextCursor` gives the correct next six (exact slugs) and a short last page with `nextCursor: null`; exact multiple of `limit` hands out no cursor to an empty page.
  - Shared date across the boundary: fixture where items 6, 7, 8 (in `newest` order) share a date; page two starts at item 7 exactly, in both sorts (assert exact slugs).
  - Catalogue changes between pages: take page one's cursor from list A; add a newer item (newest) / an older item (oldest) to form list B; page two from B equals page two from A, exact slugs, no duplicate of page one, nothing skipped. Also: remove the bookmarked item itself; page two is still the same six.
  - Cursor: round-trips `{ sort, createdAt, slug }`; opaque (does not contain the slug) and `^[A-Za-z0-9_-]+$`; `newest` cursor decoded for `oldest` throws `CursorSortMismatchError`; garbage (`"%%%garbage"`, base64 of `"after:x"`, base64 of `{"sort":"newest"}`, bad `createdAt`, empty slug) throws `UnknownCursorError`.
  - `shopProductsQueryKey("oldest")` equals `["shop", "products", 6, "oldest"]`.
- **Negative check (do it, then revert):** temporarily make the comparator return `0` on equal `createdAt` (no slug tie-break) and run `yarn workspace website vitest run --project unit src/lib/shop/__tests__/pagination.unit.test.ts`. The shared-date test must fail. Revert and re-run green. State in the implementation report that this was tried, which test failed, and that it was reverted.

### 5. `pages.ts`: sort in the cached function

- `getProductsPage(cursor: string | null, limit: number, sort: ShopSort)` → `selectPage(allProducts, cursor, limit, sort)`.
- Update the doc comment: one cache entry per `(cursor, limit, sort)`; sort is in the key because `cursor = null` is a different page one per sort (and a cursor for one sort is rejected for the other before it ever reaches here); same `shop-products` tag, so one `revalidateTag` still clears both orders.

### 6. Endpoint: `sort` param

- `querySchema` gains `sort: shopSortSchema.default(DEFAULT_SHOP_SORT)`. An empty `sort=` should mean default, like `cursor=`: reuse the same `preprocess` empty-to-undefined.
- Outside-the-cache check becomes `decodeCursor(cursor, sort)` when a cursor is present: `UnknownCursorError` → 400 `{ error: "Unknown cursor" }`; `CursorSortMismatchError` → 400 `{ error: "Cursor is for a different sort" }`. Neither calls Sentry.
- `getProductsPage(cursor ?? null, limit, sort)`. Update the JSDoc to `GET /api/shop/products?cursor=&limit=&sort=`.
- `route.unit.test.ts`: default is newest (first item is the newest registry product, computed with `sortProducts(allProducts, "newest")[0]`, and also assert the literal `sample-product-fourteen`); `sort=oldest` first item is `sample-product-twelve`; `sort=bogus` → 400; `sort=` → newest; following `nextCursor` through all pages yields exactly `sortProducts(allProducts, sort)` for both sorts (no dupes, no gaps); a cursor from `sort=oldest` sent with `sort=newest` → 400 and no Sentry call; garbage cursor → 400. Replace #163's "unknown slug → 400" case: a well-formed cursor whose slug is not in the registry now returns 200 with the items strictly after its tuple.

### 7. Server page and prefetch

- `page.tsx`: `export default function ShopIndexPage({ searchParams }: PageProps<"/shop">)` (not `async`, does not await). Pass `searchParams` to `<ShopProducts searchParams={searchParams} />` inside the existing `<Suspense>`. Rewrite the comment: the page still reads nothing from the request itself; the list hole awaits `searchParams`, which makes only the hole dynamic; the shell stays static. Canonical stays `/shop` (sort variants are the same content).
- `ShopProducts.tsx`: prop `searchParams: Promise<Record<string, string | string[] | undefined>>` (or the `PageProps<"/shop">["searchParams"]` type). `const sort = shopSortSchema.catch(DEFAULT_SHOP_SORT).parse((await searchParams).sort)`. `getFirstPageState(sort)` keeps `"use cache"`/tag/life, uses `shopProductsQueryKey(sort)` and `getProductsPage(pageParam, SHOP_PAGE_SIZE, sort)` (cache entry per sort; the `Date.now()` rationale is unchanged). Render:
  ```
  <ShopSortControl sort={sort} />
  <HydrationBoundary state={…}><ProductList sort={sort} /></HydrationBoundary>
  ```
  Keep the control outside `HydrationBoundary` but inside the hole, so its value always matches the list it sits above.

### 8. `ProductList`: sort-aware query

- Props `{ sort: ShopSort }`. `queryKey: shopProductsQueryKey(sort)`; `fetchProductsPage(cursor, sort, signal)` adds `sort` to the params only when it is not the default (keeps request URLs matching the page's URL convention; the endpoint defaults anyway). No `useEffect`, no manual reset: a new key is a new query.
- Update the doc comment: the key carries the sort; switching sort starts at a fresh page one; the server prefetch for the new sort arrives with the RSC payload from `router.replace`, so page one of the new sort is normally hydrated rather than fetched.
- `ProductList.browser.test.tsx`: switch fixtures and `renderHydrated` to `shopProductsQueryKey("newest")`/`selectPage(…, "newest")`; `servePage` reads `sort` from the URL (default `newest`). Add: rendering with `sort="newest"` hydrated, then `rerender` with `sort="oldest"` → exactly one fetch whose URL has `sort=oldest`, `limit=6` and **no** `cursor`, and the first card is the oldest fixture product; then Load more on oldest → the fetch URL carries the oldest cursor and `sort=oldest`. Existing tests keep passing with the new key.

### 9. `ShopSortControl`

- New client component `ui/ShopSortControl.tsx`, props `{ sort: ShopSort }`. A visible `<label>` "Sort" (`uppercase tracking-[0.2em] text-xs`, same as `ProductCard`'s brand line) tied to a native `<select>` with options `Newest first` (`newest`) and `Oldest first` (`oldest`), styled to match (`uppercase tracking-[0.2em] text-xs bg-transparent`, border like WishlistDialog's trigger, `min-h-11` touch target). Right-aligned above the grid (`flex justify-end mb-6`). No library.
- `const router = useRouter(); const pathname = usePathname(); const [isPending, startTransition] = useTransition(); const [shown, setShown] = useOptimistic(sort);` `onChange`: parse the value with `shopSortSchema`, then `startTransition(() => { setShown(next); router.replace(next === DEFAULT_SHOP_SORT ? pathname : `${pathname}?sort=${next}`, { scroll: false }); })`; `posthog.capture("shop_sort_changed", { sort: next })`. Put the option labels in a `Record<ShopSort, string>` so the test and component share them only if the e2e spec needs them; otherwise keep them local. `aria-busy={isPending}` on the select.
- No `useSearchParams` (it would force a CSR bailout boundary); the server passes `sort`.
- `ShopSortControl.browser.test.tsx` (mock `next/navigation` `useRouter`/`usePathname` → `/shop`, mock `posthog-js`, as the booking browser tests do): renders with `newest` selected; choosing `Oldest first` calls `replace("/shop?sort=oldest", { scroll: false })` and captures `shop_sort_changed { sort: "oldest" }`; rendered with `oldest`, choosing `Newest first` calls `replace("/shop", { scroll: false })` (clean URL) and captures `{ sort: "newest" }`.

### 10. Playwright: `apps/website/e2e/shop.integration.spec.ts`

- Import `sortProducts` from `@/lib/shop/pagination`; define `const newest = sortProducts(allProducts, "newest")`, `const oldest = sortProducts(allProducts, "oldest")`. Replace `firstProduct = allProducts[0]` with `newest[0]` for the index-page tests (the product-page and wishlist tests can keep any product; use `newest[0]` throughout for simplicity). "index shows the first six" iterates `newest.slice(0, SHOP_PAGE_SIZE)` and asserts they appear **in that order** (the `article` headings/links in DOM order). "scrolling loads the next pages" asserts the last card is `newest.at(-1)`.
- New test "sort control switches order and keeps it in the URL": `goto("/shop")`; first card is `newest[0]`; select `Oldest first`; `expect(page).toHaveURL("/shop?sort=oldest")`; first card is `oldest[0]`; scroll the sentinel twice → all 15 cards, in exactly `oldest` order (no duplicates); select `Newest first` → `toHaveURL("/shop")` (no query string) and first card is `newest[0]`; `page.goBack()` → URL `/shop?sort=oldest` and first card `oldest[0]`.
- New test "a shared oldest link opens in that order without an API call for page one": record `/api/shop/products` requests; `goto("/shop?sort=oldest")`; first six cards equal `oldest.slice(0, 6)`, the select shows `Oldest first`; `apiRequests` is empty.
- Extend "the products API pages with an opaque cursor": `?sort=oldest` first item is `oldest[0].slug`; `?sort=oldest&cursor=<newest nextCursor>` → 400; `?sort=bogus` → 400.
- These run in the ADW test phase (`yarn workspace website test:integration`); no DB fixtures needed (the catalogue reads no database).

### 11. Build check: static shell

- `yarn turbo run build --filter=./apps/website` and confirm `/shop` is still listed as Partial Prerender (`◐`), not fully dynamic (`ƒ`), and the build log has no `next-prerender-*` / "Uncached data was accessed outside of <Suspense>" error. If it fails, the page is awaiting `searchParams` outside the Suspense hole; fix that rather than adding `connection()`.

### 12. Run the Validation Commands

- Run every command in `Validation Commands` and fix anything red.

## Testing Strategy

### Unit Tests

- `pagination.unit.test.ts` (node): comparator/sort in both directions with the slug tie-break; `selectPage` page walks for both sorts; shared date across a page boundary; inserting a newer/older item and removing the bookmarked item between pages (exact slugs, no dupes, no skips); cursor round-trip, opacity, sort mismatch, garbage; query key includes sort. Plus the manual negative tie-breaker run.
- `route.unit.test.ts` (node): `sort` default/oldest/bogus/empty; full walk equals `sortProducts` for both sorts; cross-sort cursor 400 without Sentry; unknown-slug cursor now 200.
- `schema.unit.test.ts` (node): `createdAt` required and must be a real `yyyy-MM-dd` day.
- `products.unit.test.ts` (node): registry has a shared `createdAt`.

### Test Coverage

- `apps/website/src/lib/shop/__tests__/pagination.unit.test.ts` — catches wrong order, a missing/incorrect tie-break (items duplicated or skipped when a date is shared across pages), cursor drift when the catalogue changes, and a cursor accepted for the wrong sort. Fails today: `sortProducts`, sort-aware `selectPage` and the tuple cursor don't exist.
- `apps/website/src/app/api/shop/products/__tests__/route.unit.test.ts` — catches the endpoint ignoring or failing to validate `sort`, and a cross-sort cursor returning 200. Fails today: `sort` is not a parameter.
- `apps/website/src/lib/shop/__tests__/schema.unit.test.ts` — catches a product without, or with a malformed, `createdAt` reaching the registry. Fails today: no such field.
- `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx` — catches the query key not changing with sort (a sort switch that shows cached newest items or never refetches page one). Fails today: `ProductList` takes no `sort`.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.browser.test.tsx` — catches the URL not being updated, the default polluting the URL, and the missing `shop_sort_changed` event. Fails today: component doesn't exist.
- `apps/website/e2e/shop.integration.spec.ts` — the only layer that proves the whole journey: server-prefetched page one in the chosen order, the control round-tripping through `router.replace` and the RSC render, back/forward, and a shared `?sort=oldest` link. Fails today: no control, grid is registry order.

### Edge Cases

- Several items share the bookmark's date (tie group split across a page boundary), in both sorts.
- A newer item added before page two is requested (newest); an older one (oldest).
- The bookmarked product removed from the registry between pages: continue after its tuple, no 400.
- A cursor from `oldest` sent with `sort=newest` (and vice versa): 400.
- Garbage cursor, legacy `after:<slug>` cursor from #163, JSON missing fields, invalid `createdAt` in a cursor: 400.
- `?sort=foo`, `?sort=`, `?sort=oldest&sort=newest` (array) on the page: renders the default; on the API: `foo` is 400, empty is default.
- Exact multiple of the page size: no cursor to an empty page, in both sorts.
- Empty registry: empty page, `nextCursor: null`.
- `createdAt` like `2026-02-30`, `2026-9-1`, or with a time component: rejected at build (schema).
- Switching sort quickly twice: `useOptimistic` + transitions; the last `router.replace` wins, the select settles on the server's `sort`.

## Acceptance Criteria

- `productSchema` requires `createdAt` as a `yyyy-MM-dd` calendar-day string; all fifteen samples have one; three share `2026-05-03`; no `new Date("…")` on a date-only string anywhere in the change.
- `/shop` shows products newest first by default; `/shop?sort=oldest` shows the exact reverse; order in `products.ts` has no effect on the grid.
- `GET /api/shop/products` accepts `sort=newest|oldest` (default `newest`), 400s an invalid `sort`, 400s a cursor whose `sort` differs from the request's, and pages strictly after `(createdAt, slug)`.
- `getProductsPage(cursor, limit, sort)` is `"use cache"` with tag `shop-products`; its comment explains why `sort` is part of the key.
- Query key is `["shop", "products", SHOP_PAGE_SIZE, sort]` on both server prefetch and client; switching sort starts at page one with no manual cache clearing.
- The sort control shows `Newest first` / `Oldest first` in the uppercase letter-spaced label style; choosing oldest sets the URL to `/shop?sort=oldest`, choosing newest sets it to `/shop` with no query; back/forward restore the order; page one of either order is server-prefetched (no `/api/shop/products` request on load).
- `shop_sort_changed { sort }` is captured on every change.
- Build output still shows `/shop` as a static shell (Partial Prerender) with the list as the dynamic hole.
- `/shop/[slug]` and the sitemap are unchanged.
- The negative tie-breaker check was run, failed the shared-date test, and was reverted (stated in the implementation report).
- All validation commands pass; existing shop e2e specs pass (updated only where they assumed registry order).

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace (catches any `Product` literal missing `createdAt`, and any leftover `SHOP_PRODUCTS_QUERY_KEY`/`cursorStart` import)
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the feature works with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; inspect the route table: `/shop` is `◐` (Partial Prerender), not `ƒ`

## Notes

- **Dependency on #163.** This branch was cut before PR #164 merged; Step 1 merges `origin/feat/issue-163-adw-e50e5d95-shop-infinite-scroll-grid` (or `origin/develop` if #164 has merged by then). Until #164 merges, this PR's diff against `develop` includes #163's commits; the owner reviews both on the preview. Like #163, the issue carries `adw:hold`: the owner removes it after reviewing the preview and re-runs `gate <adw-id> --apply`.
- **No new dependencies.** Zod 4 (`z.iso.date`), TanStack Query (from #163), `next/navigation` and `posthog-js` are all already installed.
- **Behaviour change from #163:** a well-formed cursor whose slug has left the registry is no longer a 400; the tuple bookmark makes it continue correctly. Old `after:<slug>` cursors from #163 decode as garbage (400); they only ever live in a browser's in-memory query cache for an hour, and a deploy changes the page anyway, so no migration is needed.
- **Tie-break order for `oldest`:** slug descending, so `oldest` is the exact reverse of `newest` ("switching to oldest reverses"). If the owner prefers slug ascending within a day in both orders, it is a one-line comparator change plus the fixtures.
- **Why not `useSearchParams` in the client:** it would need its own Suspense boundary and would duplicate the source of truth. The server reads `searchParams` once, inside the hole, and passes `sort` down.
- **Why no `e2e/*.md` journey:** the Playwright spec covers the whole flow deterministically.
- **Manual on the preview (owner):** newest first by default; switching to oldest reverses; scrolling in each order loads the right pages; sharing `/shop?sort=oldest` opens in that order.
- Out of scope: sorting by price/name (needs the same tie-breaker treatment), filters, search, persisting the choice beyond the URL.
- Documentation phase: extend `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` or add a sibling doc for the sort and cursor format, and add/extend its `docs/conditional-docs.md` entry (conditions: changing the sort order, `createdAt`, the cursor tuple, or the `sort` param).
