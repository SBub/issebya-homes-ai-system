# Feature: Debounced shop search, filtered on the server, with the current results kept visible

## Metadata

issue_number: `167`
adw_id: `86c52a82`
issue_json: `{"number":167,"title":"Shop: debounced search box filtering the grid by name on the server, with useTransition keeping the current results visible — follow-up to #163/#165", "labels":["adw:hold"]}`

## Feature Description

`/shop` gets a search box above the product grid, next to the sort control. The visitor types; after a 300 ms pause in typing the URL becomes `/shop?q=<term>` (combined with `?sort=` from #165), the server renders page one of the products whose name contains the term (case-insensitive), and the grid swaps to those results. While the new results load, the current cards stay mounted, dimmed (`opacity-50`) and marked `aria-busy="true"`; the Suspense skeleton never flashes on a search change. Enter applies the typed text at once, Escape and clearing the box apply the empty term at once. A term with no matches shows `Nothing matches "lamp". Try another word or clear the search.` with a Clear button. The term lives in the URL, so a shared link opens with the same results, streamed from the server with no client fetch for page one. Infinite scrolling (#163) keeps working inside a search, because `q` is a server parameter carried by the cursor, like `sort`.

Without JavaScript the search box is a plain `GET` form to `/shop`, so Enter still works.

## User Story

As a visitor browsing the Issebya shop
I want to type part of a product name and see only the matching pieces
So that I can find a specific thing quickly and share a link to exactly what I found

## Problem Statement

The shop grid can only be scrolled and sorted. A visitor looking for one kind of piece has to scroll through the whole catalogue, and there is no way to share a narrowed list. A naive client-side search would also break the contracts #163/#165 set: the grid is server-paged with a keyset cursor, so filtering only the loaded pages would miss unloaded matches, and a new query key per keystroke would flash the Suspense skeleton and spam the server.

## Solution Statement

Treat search exactly like sort in #165: a server parameter, validated with Zod, part of the query key, the cache key, the URL and the cursor.

- `src/lib/shop/pagination.ts`: `filterByName(products, q)` runs before `sortProducts` inside `selectPage`; the cursor bookmark gains `q`; a cursor whose `q` differs from the request's throws `CursorSearchMismatchError` (route returns 400). `ProductsPage` gains `total` (number of matches for the term) so the empty state and the analytics event have a count without a second request.
- `getProductsPage(cursor, limit, sort, q)`, `getFirstPageState(sort, q)` and `shopProductsQueryKey(sort, q)` all carry `q`. `GET /api/shop/products` reads `?q=`.
- A new client component `ShopControls` owns one `useTransition`. It renders the search form, the sort select, and a grid wrapper that is dimmed and `aria-busy` while `isPending`. `ShopProducts` (server) passes `sort`, `q` and `total` in, and the hydrated `ProductList` as `children`, so a single `isPending` covers both controls and the grid. URL changes go through `router.replace` (search) / `router.push` (sort, unchanged behaviour from #165) inside `startTransition`, which is what keeps the already-revealed Suspense boundary on the old cards instead of the fallback.
- `useDebouncedValue(value, delayMs)` in `src/lib/use-debounced-value.ts` delays only the searched value; the input stays controlled by the raw text so every keystroke shows immediately.
- A pure `shopHref(pathname, { sort, q })` builder keeps both parameters when either changes (the #165 sort control currently builds `?sort=` alone and would drop `q`).

## Relevant Files

Use these files to implement the feature:

IMPORTANT: this work applies on top of #163 and #165, which are open PRs (#164, #166) and are **not** in this branch yet. The files below marked "(from #165)" exist only after the first task merges `origin/feat/issue-165-adw-bdeb9a75-sort-shop-grid-server-side` (which already contains #163).

- `README.md`, `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook gates).
- `apps/website/AGENTS.md` - website rules: server components by default, Zod at API boundaries, which test layers gate (unit + browser gate on push; Playwright e2e runs only in the ADW test phase), keep browser tests component-scoped.
- `apps/website/src/lib/shop/pagination.ts` (from #165) - `SHOP_PAGE_SIZE`, sort schema, `shopProductsQueryKey`, `ProductsPage`, cursor codec (`encodeCursor`/`decodeCursor`), error classes, `sortProducts`, `selectPage`. Gets `filterByName`, the `q` schema, `q` in the cursor and key, `total`, `CursorSearchMismatchError`, and `shopHref`.
- `apps/website/src/lib/shop/pages.ts` (from #165) - cached `getProductsPage(cursor, limit, sort)`; gains `q` as a fourth argument (part of the `"use cache"` key).
- `apps/website/src/app/api/shop/products/route.ts` (from #165) - `GET` handler with Zod query schema and pre-cache cursor validation; gains `q` and the new 400.
- `apps/website/src/app/api/shop/products/__tests__/route.unit.test.ts` (from #165) - route unit tests; extend for `q`.
- `apps/website/src/lib/shop/__tests__/pagination.unit.test.ts` (from #165) - pagination unit tests; extend for `filterByName`, `q` paging, cross-`q` cursor, `total`, `shopHref`.
- `apps/website/src/app/(main)/shop/page.tsx` (from #165) - static shell, the one list `<Suspense>` with `ProductGridSkeleton`; comment update only (the hole now also reads `q`).
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` (from #165) - server Suspense hole: parses `sort` from `searchParams`, prefetches page one in `getFirstPageState`, renders `ShopSortControl` + `HydrationBoundary`/`ProductList`. Gains `q` and renders `ShopControls` around the hydrated list.
- `apps/website/src/app/(main)/shop/ui/ProductList.tsx` (from #165) - client infinite list, `fetchProductsPage` builds `/api/shop/products?...`; gains a `q` prop, forwards it to the key and the request.
- `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx` (from #165) - its `servePage` double must read `q`; its `ProductList` renders need the `q` prop.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.tsx` (from #165) - becomes a controlled, presentational `<select>` (value, onChange, busy); the transition, `useOptimistic`, `router.push` and `posthog` move to `ShopControls`.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.browser.test.tsx` (from #165) - rewrite for the presentational API; the URL/analytics assertions move to `ShopControls.browser.test.tsx`.
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx` (from #163) - `PRODUCT_GRID_CLASS` and the skeleton; used as the fallback the new browser test proves never shows on a search change.
- `apps/website/src/lib/shop/query-client.ts` (from #163) - shared `QueryClient` options (pending-query dehydration); read only, no change expected.
- `apps/website/e2e/shop.integration.spec.ts` (from #165) - Playwright shop specs; extend with search journeys.
- `apps/website/src/lib/shop/products.ts` (from #165) - the static registry: names are `Sample Product One` … `Sample Product Fifteen`. Relevant for test terms: `teen` matches Thirteen/Fourteen/Fifteen, `product` matches all 15, `lamp` matches nothing.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` - the labelled-input pattern (`<label htmlFor>` + `<input id>`) to follow.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` - wishlist button family: bordered, uppercase, `tracking-[0.2em]` styling to match.
- `apps/website/vitest.config.ts` - browser project `include` globs; needs `src/lib/**/*.browser.test.tsx` for the hook test.
- `apps/website/vitest.browser.setup.ts` - browser test setup; read to know what is globally stubbed.
- `knip.json` - `apps/website` entries include `*.unit.test.ts` / `*.browser.test.tsx`; every new export must have a real (non-test) consumer or knip fails.
- `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` and `apps/website/app_docs/feature-bdeb9a75-shop-server-side-sort.md` (from #163/#165) - the design notes for the paging/sort contracts this feature extends.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Server vs Client Component split (conditional-docs: adding/changing a route or Server Component).
- `apps/website/app_docs/data-fetching-client.md` - the documented exception for fetching pages 2+ from the client (conditional-docs: tempted to fetch from a Client Component).
- `apps/website/app_docs/component-patterns-guide.md` - creating components (conditional-docs).
- `apps/website/app_docs/client-form-guide.md` and `apps/website/app_docs/form-re-render-strategy.md` - building a form; keystroke re-render concerns (conditional-docs).
- `apps/website/app_docs/zod-validation-guide.md` - adding the `q` schema (conditional-docs).
- `apps/website/app_docs/import-patterns-guide.md` - destructured imports (conditional-docs).
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy: no bold, no em dashes, no emojis (conditional-docs).
- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md` and `apps/website/app_docs/feature-e9bc2126-shop-card-image-carousel.md` - shop grid/card structure; the carousel doc warns that a browser test rendering a shop page must mock `posthog-js`.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md`, `apps/website/app_docs/testing/e2e_example.md` - test spec formats (conditional-docs).
- `node_modules/next/dist/docs/` - per `apps/website/AGENTS.md`, read the `useRouter` (`replace`, `scroll: false`), `searchParams` and Cache Components / `"use cache"` docs before coding.

### New Files

- `apps/website/src/lib/use-debounced-value.ts` - `useDebouncedValue<T>(value: T, delayMs: number): T`.
- `apps/website/src/lib/__tests__/use-debounced-value.browser.test.tsx` - hook test with fake timers (browser project, see Notes for why not `*.unit.test.ts`).
- `apps/website/src/app/(main)/shop/ui/ShopControls.tsx` - client component: one `useTransition`, search + sort + dimmed grid wrapper + empty state + analytics.
- `apps/website/src/app/(main)/shop/ui/ShopSearch.tsx` - presentational search form (`<form role="search" action="/shop" method="get">`, label, `<input type="search" name="q">`, hidden `sort`).
- `apps/website/src/app/(main)/shop/ui/ShopControls.browser.test.tsx` - debounce, Enter, Escape, clear, URL composition, pending/aria-busy, previous cards kept, no skeleton, empty state, analytics.

## Implementation Plan

### Phase 1: Foundation

Bring #163 and #165 into this branch, then extend the pure, node-testable layer: `filterByName`, the `q` schema, `q` in the cursor bookmark and the query key, `total` on `ProductsPage`, the `CursorSearchMismatchError`, and the `shopHref` URL builder. Add `useDebouncedValue`. All of this is unit-testable before any UI changes.

### Phase 2: Core Implementation

Thread `q` through the server: `getProductsPage`, the API route (Zod + 400 on cross-`q` cursors), and `ShopProducts` (lenient parse from `searchParams`, prefetch page one per `(sort, q)`). Build `ShopControls` (transition owner) and `ShopSearch` (form), and turn `ShopSortControl` into a controlled select. `ProductList` takes `q`.

### Phase 3: Integration

Wire `ShopControls` into `ShopProducts` with the hydrated list as `children`, add the empty state and analytics, update the existing browser tests to the new component APIs, extend the Playwright shop spec with search journeys, and run the full validation set.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Bring #163 and #165 into this branch

- `git fetch origin` then `git merge --no-edit origin/feat/issue-165-adw-bdeb9a75-sort-shop-grid-server-side` (this branch contains #163 too; #165 was built the same way on top of #163).
- Run `yarn install` (the merge adds `@tanstack/react-query` to `apps/website/package.json` and `yarn.lock`).
- Confirm the "(from #165)" files listed above now exist. If the merge conflicts, stop and report rather than resolving shop files by guesswork.
- Read `node_modules/next/dist/docs/` on `useRouter` (`replace`, `{ scroll: false }`) and on `"use cache"` argument keys before editing.

### 2. Extend `src/lib/shop/pagination.ts` with search

- Add `export const SHOP_SEARCH_MAX_LENGTH = 60;` and `export const shopSearchSchema = z.string().trim().max(SHOP_SEARCH_MAX_LENGTH);` (empty string is valid and means "no filter").
- Add `export function filterByName(products: readonly Product[], q: string): Product[]`: trims `q`; empty returns a copy of all products; otherwise `product.name.toLowerCase().includes(term.toLowerCase())`. Never mutates the input. Only `name` is searched (description and brand are out of scope).
- `shopProductsQueryKey(sort, q)` returns `["shop", "products", SHOP_PAGE_SIZE, sort, q] as const`. Update the doc comment: `q` in the key means a new term is a new query starting at its own page one.
- `ProductsPage` becomes `{ items: Product[]; nextCursor: string | null; total: number }`, where `total` is the number of products matching `q` (the whole catalogue when `q` is empty).
- Cursor bookmark schema gains `q: z.string().max(SHOP_SEARCH_MAX_LENGTH).default("")`. The `default("")` keeps cursors handed out by the pre-search build valid for the unfiltered list instead of turning them into 400s. `encodeCursor` writes `{ sort, q, createdAt, slug }`.
- Add `export class CursorSearchMismatchError extends Error` (message `"Cursor is for a different search"`, `name` set), mirroring `CursorSortMismatchError`.
- `decodeCursor(cursor, sort, q)`: after the sort check, throw `CursorSearchMismatchError` when `parsed.data.q !== q`. Update its doc comment.
- `selectPage(products, cursor, limit, sort, q)`: `const sorted = sortProducts(filterByName(products, q), sort)`; decode with `q`; encode `nextCursor` with `q`; return `total: sorted.length`. Update the doc comment (filter before sort and page).
- Add the URL builder used by both controls:
  `export function shopHref(pathname: string, { sort, q }: { sort: ShopSort; q: string }): string` - `URLSearchParams`, sets `sort` only when not `DEFAULT_SHOP_SORT`, sets `q` only when the trimmed term is non-empty, returns `pathname` alone when no params, else `${pathname}?${params}` (order: `sort` then `q`, so `/shop?sort=oldest&q=teen`). `URLSearchParams` encodes spaces as `+`, which Next decodes back to a space in `searchParams`.
- Keep the module free of `products.ts` and `next/cache` imports (it is imported by client components).

### 3. Unit-test the pagination changes (`src/lib/shop/__tests__/pagination.unit.test.ts`)

- Update existing calls to the new `selectPage(..., sort, q)` / `decodeCursor(..., sort, q)` / `shopProductsQueryKey(sort, q)` signatures, and existing `toEqual` shapes to include `total`.
- `filterByName`: case-insensitive (`"TEEN"` and `"teen"` match the same set), trims (`"  teen "` equals `"teen"`), empty and whitespace-only return everything, no match returns `[]`, input array is not mutated, only `name` is matched (a fixture whose brand or description contains the term but whose name does not is excluded).
- `selectPage` with `q`: pages a filtered set correctly across pages with no duplicates or gaps (fixture with more than `limit` matches), `total` equals the match count on every page, `nextCursor` is `null` on the last filtered page, zero matches returns `{ items: [], nextCursor: null, total: 0 }`.
- Cursor: a cursor from `q = "a"` passed with `q = "b"` throws `CursorSearchMismatchError`; with `q = ""` also throws; a legacy bookmark without `q` (hand-encoded `{ sort, createdAt, slug }`) decodes as `q = ""`.
- `shopProductsQueryKey("newest", "teen")` equals `["shop", "products", SHOP_PAGE_SIZE, "newest", "teen"]`.
- `shopHref`: `/shop` for defaults; `/shop?q=teen`; `/shop?sort=oldest`; `/shop?sort=oldest&q=teen`; whitespace-only `q` is omitted; a term with a space and `&` round-trips through `new URL(...).searchParams.get("q")`.
- `shopSearchSchema`: trims, accepts 60 characters after trimming, rejects 61.

### 4. Thread `q` through `getProductsPage` (`src/lib/shop/pages.ts`)

- Signature `getProductsPage(cursor, limit, sort, q)`; pass `q` to `selectPage`. Update the comment: `q` must be in the cache key for the same reason as `sort` (`cursor = null` is a different page one per term); the key space is bounded by the 60-character cap and the cache's LRU.

### 5. Read `q` in `GET /api/shop/products` (`src/app/api/shop/products/route.ts`)

- Query schema gains `q: z.preprocess(emptyToUndefined, shopSearchSchema.optional())`, defaulting to `""` after parse. Over-long `q` is a 400 (`"Invalid query"`), same as a bad `limit`.
- `decodeCursor(cursor, sort, q)`; map `CursorSearchMismatchError` to `400 { error: "Cursor is for a different search" }`.
- Pass `q` to `getProductsPage`; return `{ items, nextCursor, total }`.
- Update the handler comment to `GET /api/shop/products?cursor=&limit=&sort=&q=`.

### 6. Unit-test the route (`src/app/api/shop/products/__tests__/route.unit.test.ts`)

- Follow the file's existing mocking of `getProductsPage`/`selectPage`. Add: `?q=teen` forwards `"teen"` to `getProductsPage`; `?q=%20teen%20` forwards `"teen"`; `?q=` and no `q` forward `""`; 61-character `q` returns 400; a cursor issued for `q=a` requested with `q=b` returns 400 with `"Cursor is for a different search"` and never calls `getProductsPage`; response body includes `total`.

### 7. Add `useDebouncedValue` (`src/lib/use-debounced-value.ts`)

- `export function useDebouncedValue<T>(value: T, delayMs: number): T`: `useState(value)` plus a `useEffect` on `[value, delayMs]` that sets a `setTimeout(() => setDebounced(value), delayMs)` and clears it in cleanup. The effect is the legitimate kind (synchronising with a timer, an external system). No `"use client"` directive (it is a hook imported only by client components).
- Short doc comment: the input shows the raw value; only the returned value waits.

### 8. Test `useDebouncedValue` (`src/lib/__tests__/use-debounced-value.browser.test.tsx`)

- Add `"src/lib/**/*.browser.test.tsx"` to the browser project's `include` in `apps/website/vitest.config.ts`.
- Use `renderHook` from `vitest-browser-react` with a `value` prop and `vi.useFakeTimers()` (restore in `afterEach`). Wrap timer advances and rerenders in `act` from `react`.
- Cases: initial render returns the initial value; after `rerender("a")`, `rerender("ab")`, `rerender("abc")` in quick succession, advancing 299 ms still returns the initial value, advancing 1 more ms returns `"abc"`; a result-change counter (a render-count ref or a spy on the returned values) shows it emitted exactly one new value, not `"a"`/`"ab"`; a change at 200 ms restarts the 300 ms window.

### 9. Make `ShopSortControl` a controlled select

- New props: `{ value: ShopSort; onChange: (next: ShopSort) => void; busy: boolean }`. It keeps `useId`, the label `Sort`, `SORT_LABELS`, the styling, and parses the `<select>` value with `shopSortSchema`. Remove `useRouter`, `usePathname`, `useTransition`, `useOptimistic` and `posthog` from it (they move to `ShopControls`). It no longer renders its own `mb-6 justify-end` row wrapper; `ShopControls` lays out the row.
- Rewrite `ShopSortControl.browser.test.tsx`: shows the value it is given; selecting "Oldest first" calls `onChange("oldest")` once; `busy` sets `aria-busy="true"` on the select.

### 10. Add `ShopSearch` (`src/app/(main)/shop/ui/ShopSearch.tsx`)

- Presentational client component. Props: `{ value: string; sort: ShopSort; onChange: (text: string) => void; onSubmit: () => void; onEscape: () => void; busy: boolean }`.
- Markup: `<form role="search" action="/shop" method="get" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>`, a visible `<label htmlFor={id}>` reading `Search` styled like the sort label (`uppercase tracking-[0.2em] text-xs`), and `<input type="search" id={id} name="q" aria-label="Search products" placeholder="Search pieces" maxLength={SHOP_SEARCH_MAX_LENGTH} autoComplete="off" value={value} onChange={...} onKeyDown={...}>`. Style like the sort select: `min-h-11 px-3 border border-background/60 bg-transparent text-xs tracking-[0.2em] placeholder:uppercase placeholder:text-background/60 transition-colors hover:border-background focus:border-background`.
- When `sort !== DEFAULT_SHOP_SORT`, render `<input type="hidden" name="sort" value={sort}>` so the no-JS GET keeps the order.
- `onKeyDown`: on `Escape`, `preventDefault()` and call `onEscape()` (do not rely on the browser's native search-clear, which varies).
- No submit button is required (Enter submits a single-field form, with or without JS). Do not use `next/form`: the JS path is handled by `ShopControls`.
- Copy: no bold, no em dashes, no emojis.

### 11. Add `ShopControls` (`src/app/(main)/shop/ui/ShopControls.tsx`)

- `"use client"`. Props: `{ sort: ShopSort; q: string; total: number; children: ReactNode }` (children is the server-rendered `HydrationBoundary` + `ProductList`).
- Export `SHOP_SEARCH_DEBOUNCE_MS = 300` from this file only if the browser test imports it; otherwise keep it a module constant (knip).
- State and hooks:
  - `const router = useRouter(); const pathname = usePathname(); const [isPending, startTransition] = useTransition();`
  - `const [shownSort, setShownSort] = useOptimistic(sort);` (moved from `ShopSortControl`).
  - `const [text, setText] = useState(q);` (raw input, every keystroke).
  - `const [applied, setApplied] = useState(q);` (the last term this component sent to the URL, trimmed).
  - Sync with external URL changes using the "adjust state when a prop changes" render pattern, not an effect: keep `const [seenQ, setSeenQ] = useState(q)`; if `q !== seenQ`, `setSeenQ(q)` and, only when `q !== applied` (the change did not come from this component, e.g. the header's Shop link to bare `/shop`), `setText(q); setApplied(q)`. This must not clobber the input when the server confirms an older term the user has already typed past.
  - `const debounced = useDebouncedValue(text, SHOP_SEARCH_DEBOUNCE_MS);`
- `applySearch(raw: string)`: `const term = raw.trim(); if (term === applied) return; setApplied(term); requestedRef.current = term; startTransition(() => { router.replace(shopHref(pathname, { sort: shownSort, q: term }), { scroll: false }); });`
- Debounced apply: `useEffect(() => { applySearch(debounced); }, [debounced])` (synchronising the debounced value to the router; `applySearch` is a no-op when the term is unchanged, so Enter-then-debounce and clear-then-debounce do not double-navigate). Satisfy `react-hooks/exhaustive-deps` with `useEffectEvent` (React 19.2) for `applySearch` rather than suppressing the rule.
- Input handlers: `onChange(next)`: `setText(next)`; if `next.trim() === ""`, `applySearch("")` immediately. `onSubmit`: `applySearch(text)`. `onEscape` and the empty-state Clear button: `setText(""); applySearch("")`.
- Sort handler (moved from `ShopSortControl`): `startTransition(() => { setShownSort(next); router.push(shopHref(pathname, { sort: next, q: applied }), { scroll: false }); }); posthog.capture("shop_sort_changed", { sort: next });` Push, not replace, keeps #165's back/forward behaviour; `q: applied` keeps the current term (the old control dropped it).
- Analytics: `shop_search_applied { length, results }` once per applied non-empty term, after its results are known. `useEffect` on `[q, total]`: if `q !== "" && q === requestedRef.current`, `posthog.capture("shop_search_applied", { length: q.length, results: total })` then `requestedRef.current = null`. It does not fire per keystroke, for the empty term, for a shared link's initial render, or for a sort change.
- Render:
  - A row `<div className="mb-6 flex flex-wrap items-end justify-between gap-4 text-background">` with `<ShopSearch ...busy={isPending}>` on the left and `<ShopSortControl value={shownSort} onChange={onSortChange} busy={isPending}>` on the right.
  - The grid wrapper `<div data-testid="shop-grid" aria-busy={isPending} className={`transition-opacity ${isPending ? "opacity-50" : ""}`}>`. Render `aria-busy="true"` only when pending (pass `isPending || undefined`) so the idle DOM is clean.
  - Inside it: if `q !== "" && total === 0`, the empty state `<div role="status" className="py-16 text-center text-background"><p>Nothing matches "{q}". Try another word or clear the search.</p><button type="button" onClick={clear} className="mt-4 border border-background px-6 py-2 uppercase tracking-[0.2em] text-xs">Clear</button></div>` in the grid's place; otherwise `children`. Export the copy builder (e.g. `shopSearchEmptyCopy(q)`) from `src/lib/shop/pagination.ts` only if the e2e spec imports it, so the spec and the component cannot drift.
- Doc comment explaining the mechanism: the URL update runs in `startTransition`, so React keeps the already-revealed `/shop` Suspense boundary showing the old cards while the new server render (and its hydrated page one) arrives; the Suspense fallback only ever shows on first load. `placeholderData: keepPreviousData` is not used and is not the mechanism.

### 12. Pass `q` to `ProductList`

- Props `{ sort: ShopSort; q: string }`. Key `shopProductsQueryKey(sort, q)`. `fetchProductsPage(cursor, sort, q, signal)` sets `q` only when non-empty. Update the doc comment: a new term, like a new sort, is a new query whose page one normally arrives hydrated with the RSC payload of the navigation.
- Update `ProductList.browser.test.tsx`: `servePage` reads `q` from the URL and passes it to `selectPage`; renders pass `q=""`; add one case that `q="0"` (matching a subset of the fixture) requests `/api/shop/products?...&q=0` for page two with the cursor from the filtered page one.

### 13. Wire `ShopProducts`

- Parse leniently, like sort: `const params = await searchParams; const sort = ...; const q = shopSearchSchema.catch("").parse(params.q);` (an array or over-long hand-typed `q` shows the full grid rather than an error).
- `getFirstPageState(sort, q)` prefetches `shopProductsQueryKey(sort, q)` with `getProductsPage(pageParam, SHOP_PAGE_SIZE, sort, q)`.
- Get `total` for the empty state and analytics from the same cached call: `const { total } = await getProductsPage(null, SHOP_PAGE_SIZE, sort, q);` (same cache entry the prefetch fills; no extra work).
- Render:
  ```tsx
  <ShopControls sort={sort} q={q} total={total}>
    <HydrationBoundary state={await getFirstPageState(sort, q)}>
      <ProductList sort={sort} q={q} />
    </HydrationBoundary>
  </ShopControls>
  ```
- Update the component's doc comment (the hole now reads `sort` and `q`; the controls and the dimmed wrapper sit inside the hole so their values always match the list). Update the `page.tsx` comment likewise; canonical stays `/shop`.

### 14. Browser-test `ShopControls` (`src/app/(main)/shop/ui/ShopControls.browser.test.tsx`)

- Mock `next/navigation` (`useRouter` returning `{ replace, push }`, `usePathname` returning `"/shop"`) and `posthog-js` exactly as `ShopSortControl.browser.test.tsx` does. Children are stand-ins, not the real `ProductList` (component-scoped per `apps/website/AGENTS.md`).
- Harness for the transition tests: a small `Harness` component holds `[q, setQ] = useState("")`; the mocked `replace(href)` parses `q` from `href` and calls `setQ` (it runs inside `ShopControls`'s `startTransition` callback, so the update is part of the transition). It renders `<Suspense fallback={<div data-testid="skeleton" />}><ShopControls sort="newest" q={q} total={...}><Cards q={q} /></ShopControls></Suspense>`, where `Cards` renders `<article>`s for the current term and, for a new term, calls `use(pendingPromise)` so it suspends until the test resolves the promise.
- Tests:
  - Typing `lam` quickly results in exactly one `replace`, with `"/shop?q=lam", { scroll: false }`, after the debounce; waiting a further 400 ms still shows one call. The input shows each character as typed (`toHaveValue("l")` right after the first key, before any `replace`).
  - Enter applies at once: type `lam`, press Enter, `replace` has been called with `?q=lam` before 300 ms have passed; after the debounce window it is still exactly one call.
  - Escape clears: from `q="lam"`, Escape empties the input and calls `replace("/shop", { scroll: false })` at once.
  - Clearing the box by deleting all characters calls `replace("/shop", ...)` at once, without waiting for the debounce.
  - Composes with sort: rendered with `sort="oldest"`, typing `teen` replaces with `/shop?sort=oldest&q=teen`; with `q="teen"`, choosing "Newest first" pushes `/shop?q=teen` and captures `shop_sort_changed`.
  - Pending keeps the previous results: with the initial cards on screen, type a term; while the child suspends, the wrapper (`getByTestId("shop-grid")`) has `aria-busy="true"` and class `opacity-50`, the initial `article`s are still in the DOM, and `getByTestId("skeleton")` is absent. Resolve the promise: new cards render, `aria-busy` is gone.
  - Empty state: `q="lamp"`, `total={0}` renders `Nothing matches "lamp". Try another word or clear the search.` and a `Clear` button instead of the children; clicking Clear empties the input and calls `replace("/shop", ...)`.
  - Analytics: after a debounced term is applied and the harness re-renders with that `q` and `total={3}`, `shop_search_applied` is captured exactly once with `{ length: 4, results: 3 }`; nothing is captured for intermediate keystrokes, for the empty term, or on an initial render with a non-empty `q` (shared link).
  - External URL change: re-rendering with `q` changed to `""` from outside (not via `replace`) empties the input.
- **Negative check (required by the issue)**: temporarily remove `startTransition` around `router.replace` in `ShopControls`, run this file, confirm the "pending keeps the previous results" test fails (the fallback shows and the old cards unmount), then revert. State in the implementation report that this was tried and reverted.

### 15. Extend the Playwright spec (`apps/website/e2e/shop.integration.spec.ts`)

- Compute expectations from the registry, as the existing tests do: `const teen = filterByName(allProducts, "teen")` sorted with `sortProducts(..., "newest")` / `"oldest"`.
- "search narrows the grid after a pause and keeps the term in the URL": go to `/shop`, `getByRole("searchbox", { name: "Search products" }).pressSequentially("teen")`, expect URL `/shop?q=teen`, expect card links to equal the newest-first `teen` names (3 cards), clear the box (`fill("")`), expect URL `/shop` and `SHOP_PAGE_SIZE` cards.
- "Enter applies the search immediately": type `teen` with `pressSequentially`, press Enter, expect URL `/shop?q=teen` and 3 cards.
- "a shared search link streams its results without an API call": record `/api/shop/products` requests, `goto("/shop?sort=oldest&q=teen")`, expect the oldest-first `teen` names, the searchbox value `teen`, the sort value `oldest`, and zero API requests.
- "searching keeps infinite scroll working inside the results": `goto("/shop?q=product")` (all 15 match), scroll the sentinel twice, expect `allProducts.length` cards, and each API request URL carries `q=product`.
- "a term with no matches shows the empty message and Clear restores the grid": search `lamp`, expect the exact copy `Nothing matches "lamp". Try another word or clear the search.`, click `Clear`, expect URL `/shop`, the empty searchbox and `SHOP_PAGE_SIZE` cards.
- "changing sort keeps the search": from `/shop?q=teen`, select "Oldest first", expect `/shop?sort=oldest&q=teen` and the oldest-first `teen` order.
- Extend "the products API pages with an opaque cursor": `?q=teen` returns 3 items, `total: 3`, `nextCursor: null`; `?q=product` page one cursor reused with `q=teen` returns 400; a 61-character `q` returns 400.
- "works without JavaScript" in a `test.describe` with `test.use({ javaScriptEnabled: false })`: go to `/shop`, fill `teen`, press Enter, expect URL `/shop?q=teen` and 3 cards.
- The "first page is not fetched from the API" and "shared oldest link" tests stay as they are and must still pass.

### 16. Run the validation commands

- Run every command in `Validation Commands` and fix anything red. Do not skip the shop Playwright spec: the ADW test phase runs `yarn workspace website test:integration`.

## Testing Strategy

### Unit Tests

- `pagination.unit.test.ts`: `filterByName` (case, trim, empty, name-only, immutability), `selectPage` with `q` (filtered paging, `total`, last page), cross-`q` cursor rejection, legacy cursor compatibility, `shopProductsQueryKey` shape, `shopHref` composition and encoding, `shopSearchSchema` 60-character cap.
- `route.unit.test.ts`: `q` parsing (trim, empty, absent, over-long 400), cross-`q` cursor 400 before `getProductsPage`, `total` in the body.
- `use-debounced-value.browser.test.tsx`: one emission 300 ms after the last change, none before, timer restarts on change (fake timers).

### Test Coverage

- `src/lib/shop/__tests__/pagination.unit.test.ts` (`*.unit.test.ts`) - catches a search that ignores case or whitespace, filters after paging instead of before (missing unloaded matches), or accepts a cursor from another term (duplicated or skipped cards). Fails today: `filterByName`, `q` in `selectPage`/the cursor and `shopHref` do not exist.
- `src/app/api/shop/products/__tests__/route.unit.test.ts` (`*.unit.test.ts`) - catches the endpoint ignoring `?q=`, accepting an over-long term, or serving a cross-term cursor instead of a 400.
- `src/lib/__tests__/use-debounced-value.browser.test.tsx` (`*.browser.test.tsx`) - catches a debounce that fires per keystroke or early; nothing tests debouncing today.
- `src/app/(main)/shop/ui/ShopControls.browser.test.tsx` (`*.browser.test.tsx`) - catches one `replace` per keystroke, Enter/Escape/clear not applying at once, the sort control dropping `q` (or search dropping `sort`), the skeleton flashing or old cards unmounting during a search (proven to fail with `startTransition` removed), a missing `aria-busy`/dim, a blank area instead of the empty-state copy, and analytics per keystroke.
- `src/app/(main)/shop/ui/ShopSortControl.browser.test.tsx` and `ProductList.browser.test.tsx` (`*.browser.test.tsx`, updated) - keep the controlled select and the `q`-aware page-two request covered.
- `apps/website/e2e/shop.integration.spec.ts` (Playwright, extended) - the only layer proving the full journey across server and client: the real server filters, a shared `?q=` link streams page one with no API call, infinite scroll works inside a search, the no-JS GET form works.

### Edge Cases

- Whitespace-only input: treated as empty, applied at once, URL is `/shop`.
- Leading/trailing spaces: trimmed before comparison, URL and cache key (`" teen "` and `"teen"` are one query).
- Mixed case (`TEEN`, `Teen`): same results.
- Terms containing spaces, `&`, `%`, `+` or quotes: encoded by `URLSearchParams`, decoded identically by the server; the empty-state copy renders them as text (React escaping).
- 60-character term accepted; the input's `maxLength` blocks a 61st; a hand-typed 61-character `?q=` on the page falls back to the full grid, on the API returns 400.
- `?q=` given twice (array) on the page: lenient parse falls back to the full grid.
- Typing past a term whose results are still loading: the server confirming the older term must not overwrite the newer text in the input.
- Enter followed by the debounce firing for the same text: exactly one navigation.
- Sort change while a search is pending: the pushed URL carries the latest applied term.
- Navigating to bare `/shop` from the header while on `/shop?q=teen`: the input empties.
- Zero matches: empty-state copy and Clear, never a blank area; no sentinel/Load more for an empty list.
- A search whose matches exactly fill one page: `nextCursor` is `null`, no empty trailing request.
- Pre-deploy cursor without `q`: still valid for the unfiltered list.
- Back button after several searches: `replace` adds no history entries, so Back leaves `/shop` rather than stepping through terms (sort changes still push, per #165).

## Acceptance Criteria

- Typing in `Search products` updates the input on every keystroke and changes the URL to `/shop?q=<term>` once, 300 ms after the last keystroke; Enter applies immediately; Escape and emptying the box apply the empty term immediately and return to `/shop` (or `/shop?sort=oldest`).
- Results are the products whose name contains the trimmed term, case-insensitively, in the current sort order; infinite scroll pages through the filtered set with no duplicates or gaps.
- `GET /api/shop/products?q=` filters before sorting and paging, returns `total`, rejects `q` over 60 characters and a cursor issued for another term with 400.
- Query key is `["shop","products",SHOP_PAGE_SIZE,sort,q]`.
- During a search change the previous cards stay in the DOM, the grid wrapper has `aria-busy="true"` and `opacity-50`, and the Suspense skeleton is not rendered; the skeleton appears only on first load of the page.
- Opening `/shop?q=teen` (optionally with `&sort=oldest`) in a fresh tab shows the filtered page one with no `/api/shop/products` request.
- Zero matches shows `Nothing matches "<term>". Try another word or clear the search.` and a `Clear` button that restores the full grid.
- The search control is a labelled `<input type="search">` with `aria-label="Search products"` and placeholder `Search pieces`, in house style next to the sort control; the form is a plain `GET` to `/shop` that works without JavaScript.
- Changing sort keeps the term and changing the term keeps the sort.
- `shop_search_applied { length, results }` is captured once per applied non-empty term, never per keystroke.
- The negative check (removing `startTransition` makes the "previous cards remain" test fail) was run and reverted.
- All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, including the new pagination, route, debounce and `ShopControls` tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and `/shop` still prerenders its static shell with only the product list dynamic

## Notes

- **Base branch**: this depends on the unmerged #163 (PR #164) and #165 (PR #166). Task 1 merges #165's branch (which contains #163) into this one, the same way #165 merged #163. If either PR changes before this is merged, re-merge. The issue carries `adw:hold`: the owner reviews the preview before merge.
- **"One client fetch" for a typed search**: the issue expects a typed search to make one client fetch for page one. With the #165 architecture, the `router.replace` returns an RSC payload whose `HydrationBoundary` carries the new term's page one, so normally there are zero `/api/shop/products` requests for page one (the same thing #165 documents for sort). The e2e spec therefore asserts zero for a shared link and does not assert an exact count for a typed search; the owner's manual check should expect zero or one.
- **Why the hook test is a browser test**: a hook needs a React renderer and a DOM to run effects. The node unit pool has neither, and the repo has no `@testing-library/react`. `vitest-browser-react` (already a dev dependency) provides `renderHook`, so the test lives in the browser project, which requires adding `src/lib/**/*.browser.test.tsx` to its `include`. No new dependency.
- **`total` on `ProductsPage`**: added so the empty state and `shop_search_applied.results` report the real match count, not page one's (capped at 6) item count. It is computed from the in-memory array at no cost.
- **Cache growth**: every distinct `(cursor, limit, sort, q)` becomes a `"use cache"` entry. Terms are capped at 60 characters and the in-memory cache is LRU, and the catalogue is tiny; acceptable now, revisit if the catalogue moves to the database.
- **History**: search uses `router.replace` (per the issue), sort keeps `router.push` (per #165). One `useTransition` in `ShopControls` covers both.
- No new libraries.
- Only `apps/website` is touched; `telegram-router`, `guest-communication-agent` and `packages/pricing` are unaffected. No database change, no migration.
- Out of scope (per the issue): searching description or brand, fuzzy matching, a search index, highlighting matches, search on other pages.
- The document phase should add an `app_docs/feature-86c52a82-...md` entry and a `docs/conditional-docs.md` line (conditions: changing the shop search box, `q` in the cursor/query key, or when the grid flashes its skeleton on a search).
