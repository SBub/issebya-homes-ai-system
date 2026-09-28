# Chore: Shop search box and sort control belong to the static shell, not the Suspense hole

## Metadata

issue_number: `176`
adw_id: `8ad2fc3b`
issue_json: `{"number":176,"title":"Shop: search box and sort control belong to the static shell, not the Suspense hole — no layout jump when the list arrives"}`

## Chore Description

On `/shop` the search box and the sort select (`ShopControls`, a `"use client"` component) are rendered by `ShopProducts`, the page's only Suspense hole. `ShopProducts` awaits `searchParams`, reads `total` for page one, prefetches and only then renders `<ShopControls sort q total>` around the hydrated list. Consequences:

- On first load the visitor sees the skeleton grid with no controls; when page one resolves, the controls row appears above the grid and pushes every card down (visible content jump).
- The controls are missing from the prerendered HTML although they depend on nothing but the URL.

Goal: the controls row is on screen from the first byte at its final size, and the list fills in underneath without moving anything.

Target shape (current `develop` already has `ShopGridBoundary`, #169, so it is placed inside the controls' grid wrapper, around the inner Suspense only; that way a failed page one keeps the controls usable):

```
<section aria-label="Products" className="bg-shop-ground …">
  <Suspense fallback={<ShopControlsFallback><ProductGridSkeleton count={SHOP_PAGE_SIZE} /></ShopControlsFallback>}>
    <ShopControls>
      <ShopGridBoundary>
        <Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}>
          <ShopProducts searchParams={searchParams} />
        </Suspense>
      </ShopGridBoundary>
    </ShopControls>
  </Suspense>
</section>
```

What `total` is used for today (checked, `ShopControls.tsx`): there is **no** "N pieces" count on screen. `total` drives two things only: the empty state (`q !== "" && total === 0` shows "Nothing matches …" plus a Clear button) and the `shop_search_applied` analytics event (`results: total`). Both are data, so both move into the hole: a new small client component `ShopResults`, rendered by `ShopProducts`, owns the empty state and reports the count. It reaches back to `ShopControls` through a React context for `clear()` and for the "was this term requested by us" check, so that reconciliation logic lives in one place and is not duplicated.

Contracts that must hold (from the issue):

- `page.tsx` never awaits `searchParams`; the shell stays prerendered (same build-output symbol for `/shop` as before the change).
- `ShopControls` reads `sort` and `q` from `useSearchParams()`, parsed exactly as the server parses them (same `shopSortSchema.catch(DEFAULT_SHOP_SORT)` / `shopSearchSchema.catch("")`, including the repeated-param case), so the controls and the server-rendered list can never disagree.
- `ShopControlsFallback` renders the same DOM (search form + sort select, disabled) and the same grid wrapper, so the prerendered HTML already contains the controls at final size; the row gets an explicit `min-h-[…]` shared by both.
- `ShopControls` keeps `useTransition`, `useOptimistic` sort, the debounce, `seenQ` reconciliation, push-for-sort / replace-for-search, and the dimmed `aria-busy` grid wrapper around its `children`.
- `ShopProducts` still awaits `searchParams`, prefetches page one into the same query key and hydrates. No client fetch for page one.
- No new dependencies.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md` - repo rules (yarn only, conventional commits, lefthook gates).
- `apps/website/AGENTS.md` - workspace rules: read Next docs in `node_modules/next/dist/docs/` first; which test layers gate (browser tests gate on push/CI, Playwright e2e does not).
- `apps/website/ENGINEERING.md` - "Shop grid error boundary" section describes what wraps the grid's `<Suspense>`; must be updated for the new nesting.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` - `useSearchParams` in a prerendered route makes the tree up to the nearest `<Suspense>` dynamic; its fallback is what lands in the prerendered HTML. This is why the outer Suspense and `ShopControlsFallback` exist.
- `apps/website/app_docs/nextjs-patterns-guide.md` - server vs client components, passing server children through a client component.
- `apps/website/app_docs/component-patterns-guide.md` - fallback and real controls share markup; data-not-structure duplication.
- `apps/website/app_docs/zod-validation-guide.md` - the lenient `.catch` parsing of `sort`/`q` being shared between server and client.
- `apps/website/app_docs/testing/component_test_spec_format.md` - format for the browser tests.
- `apps/website/app_docs/testing/e2e_example.md` - format for the Playwright addition.
- `apps/website/app_docs/feature-86c52a82-shop-debounced-search.md` - the `ShopControls` transition / debounce / `seenQ` design this chore must preserve.
- `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` - page-one prefetch, `"use cache"` scope, why the skeleton matches the card box.
- `apps/website/app_docs/feature-12e4efa7-shop-grid-error-boundary.md` - `ShopGridBoundary` placement rules (inside the section, around the grid's Suspense).
- `apps/website/app_docs/feature-bdeb9a75-shop-server-side-sort.md` - sort param rules; "sort select and grid disagree" is a known failure mode.
- `apps/website/src/app/(main)/shop/page.tsx` - the static shell; recomposed per the target shape, page comment updated.
- `apps/website/src/app/(main)/shop/ui/ShopControls.tsx` - loses `sort`/`q`/`total` props; derives `sort`/`q` from `useSearchParams()`; provides the context; stops rendering the empty state and stops capturing `shop_search_applied` itself.
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` - stops rendering `ShopControls`; renders `ShopResults` around the `HydrationBoundary`; uses the shared param parser.
- `apps/website/src/app/(main)/shop/ui/ShopSearch.tsx` - gains an optional `disabled` prop for the fallback.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.tsx` - gains an optional `disabled` prop for the fallback.
- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx` - unchanged code, but moves inside `ShopControls` in `page.tsx`; its doc comment mentions its placement and is adjusted.
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx` - reused unchanged as both Suspense fallbacks' grid.
- `apps/website/src/lib/shop/pagination.ts` - home of `shopSortSchema`, `shopSearchSchema`, `DEFAULT_SHOP_SORT`, `shopHref`; gets the shared `parseShopParams` / `shopParamsFromSearch` helpers.
- `apps/website/src/lib/shop/__tests__/pagination.unit.test.ts` - unit tests for the new helpers.
- `apps/website/src/app/(main)/shop/ui/ShopControls.browser.test.tsx` - harness must switch from props to a mocked `useSearchParams`; empty-state and analytics tests move with `ShopResults`.
- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx` - renders the real `shop/page.tsx`; now also needs `ShopControls` mocked (it would otherwise call the real `useRouter`/`useSearchParams`).
- `apps/website/e2e/shop.integration.spec.ts` - Playwright spec; add the layout-stability test and the "controls in the HTML" check; fix the "Shop search form" comment, which says the search box only exists in the streamed hole.

### New Files

- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.tsx` - `"use client"`; the disabled same-DOM controls row plus the grid wrapper, taking the grid skeleton as `children`; exports the shared row/grid-wrapper class constants.
- `apps/website/src/app/(main)/shop/ui/ShopResults.tsx` - `"use client"`; takes `q`, `total`, `children`; renders the empty state (with Clear from context) or `children`; reports `shop_search_applied` via context.
- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.browser.test.tsx` - geometry test: fallback and real controls have identical row height and identical grid offset at 390 px and 1280 px.
- `apps/website/src/app/(main)/shop/ui/ShopResults.browser.test.tsx` - empty state + Clear, and the analytics report, moved from the `ShopControls` test.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the governing docs

- Read `apps/website/AGENTS.md`, the `useSearchParams` Next doc listed above, and `node_modules/next/dist/docs/01-app/**` pages on Cache Components / partial prerendering that mention `useSearchParams` (grep for it), to confirm how a `useSearchParams` client component behaves under `cacheComponents: true` (fallback in the prerendered shell; at request time it is rendered with real values). Note anything contradicting this plan in the Notes of the PR.
- Before changing anything, run `yarn turbo run build --filter=./apps/website` and record the route symbol printed for `/shop` (expected `◐` Partial Prerender under Cache Components). The same symbol must print after the change.

### 2. Shared param parsing (`src/lib/shop/pagination.ts`)

- Add `parseShopParams(params: { sort?: string | string[]; q?: string | string[] }): { sort: ShopSort; q: string }` that does exactly what `ShopProducts` does today: `shopSortSchema.catch(DEFAULT_SHOP_SORT).parse(params.sort)` and `shopSearchSchema.catch("").parse(params.q)`.
- Add `shopParamsFromSearch(search: Pick<URLSearchParams, "getAll">): { sort: ShopSort; q: string }` that rebuilds the Next `searchParams` record shape (a key present once is a string, present more than once is a `string[]`, absent is `undefined`) for `sort` and `q` and delegates to `parseShopParams`. This is what guarantees `?q=a&q=b` or `?sort=bogus` resolve identically on the client (controls) and on the server (list).
- Add unit tests to `src/lib/shop/__tests__/pagination.unit.test.ts`: default for missing/bogus/repeated `sort`; `q` trimmed; over-long (`SHOP_SEARCH_MAX_LENGTH + 1`) and repeated `q` become `""`; `shopParamsFromSearch(new URLSearchParams("sort=oldest&q=silver"))` gives `{ sort: "oldest", q: "silver" }`; and for a table of query strings `shopParamsFromSearch(new URLSearchParams(s))` equals `parseShopParams(<the record Next would build>)`.

### 3. `disabled` on the two leaf controls

- `ShopSearch.tsx`: optional `disabled?: boolean`, passed to the `<input>` only. No class changes (the disabled look must not change box size; do not add borders/padding for `disabled:`).
- `ShopSortControl.tsx`: optional `disabled?: boolean`, passed to the `<select>`. Same rule.

### 4. `ShopControlsFallback.tsx` (new, `"use client"`)

- Export `SHOP_CONTROLS_ROW_CLASS`: the current row classes plus an explicit min height, e.g. `"mb-6 flex min-h-[…] flex-wrap items-end justify-between gap-4 text-background"`. Measure the real row in a browser at 390 px (section has `px-4`, the search form and sort wrap onto two lines) and at 1280 px (one line, 44 px from `min-h-11`) and set a responsive value that equals the measured wrapped height below the breakpoint where it stops wrapping, e.g. `min-h-[104px] sm:min-h-11`; confirm the breakpoint by measurement, not by guess.
- Export `SHOP_GRID_WRAPPER_CLASS = "transition-opacity"` (the grid wrapper's base class) so the fallback and `ShopControls` share it.
- `ShopControlsFallback({ children })` renders `<div className={SHOP_CONTROLS_ROW_CLASS}>` with `<ShopSearch value="" sort={DEFAULT_SHOP_SORT} onChange={noop} onSubmit={noop} onEscape={noop} busy={false} disabled />` and `<ShopSortControl value={DEFAULT_SHOP_SORT} onChange={noop} busy={false} disabled />`, then `<div className={SHOP_GRID_WRAPPER_CLASS}>{children}</div>` (no `data-testid="shop-grid"`, that id stays unique to the live wrapper). Doc comment: why it exists (the `useSearchParams` Suspense fallback that lands in the prerendered HTML), why same DOM, why disabled (no input can be typed and then lost on hydration), and that it shows the default values until hydration swaps in the URL's.

### 5. `ShopControls.tsx`

- Remove the `sort`, `q`, `total` props; keep `children`. Derive `const { sort, q } = shopParamsFromSearch(useSearchParams());` at the top. Everything that used the props (`useOptimistic(sort)`, `useState(q)` initialisers, `seenQ` reconciliation, `sentRef`, `replaceUrl`) now uses these values unchanged: the reconciliation keeps its single implementation, only its source changes.
- Add a context (exported hook, e.g. `useShopControls()` returning `{ clear, reportResults }`, throwing if used outside the provider):
  - `clear` is the existing `clear` function.
  - `reportResults(q: string, total: number)` holds the logic of today's analytics effect: if `q !== "" && q === requestedRef.current`, `posthog.capture("shop_search_applied", { length: q.length, results: total })` and reset `requestedRef.current = null`. Make it stable (`useCallback` over refs only) so consumers' effects do not re-run per render. Note: `useEffectEvent` functions must not be passed through context; use a plain stable callback.
  - Memoise the context value on `[clear, reportResults]`, making `clear` stable too (it only calls state setters).
- Delete the old analytics `useEffect` and the empty-state branch from `ShopControls`.
- Render `<Provider>` → row `<div className={SHOP_CONTROLS_ROW_CLASS}>` (search + sort as today) → `<div data-testid="shop-grid" aria-busy={isPending || undefined} className={`${SHOP_GRID_WRAPPER_CLASS} ${isPending ? "opacity-50" : ""}`}>{children}</div>`.
- Rewrite the doc comment: `sort` and `q` come from the URL via `useSearchParams` (so the controls sit in the static shell and need their own `<Suspense>`, see `ShopControlsFallback`); the list and its match count arrive as `children` from the server; the transition keeps the old cards because the inner Suspense is already revealed.

### 6. `ShopResults.tsx` (new, `"use client"`)

- Props `{ q: string; total: number; children: ReactNode }`. Gets `{ clear, reportResults }` from `useShopControls()`.
- `useEffect(() => reportResults(q, total), [q, total, reportResults]);` (an effect that notifies another component's external system, posthog, once the server-confirmed results have committed; same semantics as before).
- Render the existing empty-state markup verbatim (same `role="status"`, copy, Clear button classes, `onClick={clear}`) when `q !== "" && total === 0`, else `children`.
- Doc comment: why the count lives in the hole (it is data from page one, not shell).

### 7. `ShopProducts.tsx`

- Replace the inline parsing with `const { sort, q } = parseShopParams(await searchParams);`.
- Return `<ShopResults q={q} total={total}><HydrationBoundary state={await getFirstPageState(sort, q)}><ProductList sort={sort} q={q} /></HydrationBoundary></ShopResults>`. Drop the `ShopControls` import. Query key, `getFirstPageState`, and the `getProductsPage` call for `total` are unchanged.
- Update the doc comment (the controls are no longer inside the hole; the empty state and match count are).

### 8. `page.tsx`

- Compose per the target shape in the Chore Description. `ShopGridBoundary` goes inside `ShopControls`, directly around the inner `<Suspense>`, so an error keeps the controls and the fallback sits inside the grid wrapper.
- Keep `page.tsx` a server component that never awaits `searchParams`, and keep the section's `aria-label`, classes and the sell link outside.
- Update the page comment: two boundaries now, the outer one for the URL-reading controls (fallback = same controls, disabled, around the skeleton, so nothing moves), the inner one for the list.
- Adjust `ShopGridBoundary`'s doc comment ("sits outside the grid's `<Suspense>`") to mention it is now inside `ShopControls`' grid wrapper, so the controls survive a failed page one.

### 9. Browser tests

- `ShopControls.browser.test.tsx`:
  - Mock `useSearchParams` in the `next/navigation` mock as `() => use(SearchContext)` where `SearchContext` is a test-local React context whose value the `Harness` provides from its `URLSearchParams` state. `navigate(href)` sets that state (it runs inside `ShopControls`' transition, as today). Do not use a mutable module variable: a pending transition would let `ShopControls` read the new URL early and break the in-flight `seenQ` semantics the tests rely on.
  - Harness renders `<SearchContext value={params}><Suspense fallback={<div data-testid="skeleton" />}><ShopControls><Suspense fallback={<div data-testid="skeleton" />}><ShopResults q={q} total={q === "" ? 15 : 3}><Cards q={q} /></ShopResults></Suspense></ShopControls></Suspense></SearchContext>` with `q`/`sort` derived via `shopParamsFromSearch(params)`; replace `initialQ`/`sort` props with an `initialSearch` string.
  - Keep every existing test green with the new harness.
  - Add: "reads sort and q from the URL" (`initialSearch="sort=oldest&q=silver"` → sort select value `oldest`, search box `silver`) and "a malformed URL shows the defaults" (`sort=bogus&q=a&q=b` → `newest`, `""`).
  - Move "a term with no matches shows the empty message, and Clear returns to /shop" and the two analytics tests into `ShopResults.browser.test.tsx` (they exercise `ShopResults` inside a real `ShopControls`, reusing the same harness pattern; export nothing from test files, duplicate the small harness or keep these tests in `ShopControls.browser.test.tsx` if sharing is cleaner, but they must render `ShopResults`).
- `ShopControlsFallback.browser.test.tsx` (new): render `ShopControlsFallback` and `ShopControls` (with `useSearchParams` mocked to `?sort=oldest&q=silver`, router mocked) side by side inside containers of fixed width 390 px and 1280 px (`style={{ width }}` plus the section's padding classes), each wrapping the same fixed-height child. Assert: the controls rows' `offsetHeight` are equal; the grid wrappers' `offsetTop` are equal; the fallback's search box and sort select are disabled and carry the same accessible names (`Search products`, `Sort`). Also assert the row `offsetHeight` is at least the `min-h` value, which pins the class in place.
- `index-pages-no-title-heading.browser.test.tsx`: add `vi.mock("./shop/ui/ShopControls", () => ({ ShopControls: ({ children }) => children }))` next to the existing `ShopProducts`/`ShopGridBoundary` mocks, with a one-line comment (it calls `useRouter`/`useSearchParams`). If `ShopControlsFallback`'s import chain breaks the browser test, mock it the same way. Existing assertions stay.

### 10. Playwright e2e (`e2e/shop.integration.spec.ts`)

- Add to the `Shop` describe, for each of `{ width: 390, height: 844 }` and `{ width: 1280, height: 800 }` (`test.use` in a nested describe or `page.setViewportSize` before `goto`): "controls and the first grid slot do not move when page one arrives".
  - Before `page.goto("/shop")`, `page.addInitScript` that polls each animation frame and, on the first frame where both `input[aria-label="Search products"]` and the skeleton's first `ul[aria-hidden="true"] > li` exist, stores their `getBoundingClientRect()` `top`/`left` on `window`; it also registers a `PerformanceObserver({ type: "layout-shift", buffered: true })` accumulating entries (with `hadRecentInput === false`) into `window`.
  - After `goto`, wait until the grid shows `SHOP_PAGE_SIZE` articles, then read `boundingBox()` of the search box and of the first `article`'s `li` (the first grid slot), and compare with the recorded skeleton-time values (equal within 1 px). If the skeleton frame was never observed (page one arrived in the same frame), the test must still assert the layout-shift sum over the products region is `0`; do not silently pass on missing data. State in the test comment which of the two paths ran is not observable, so both assertions run.
  - Negative (manual, not committed): temporarily make `ShopControlsFallback` render only `{children}` without the controls row (the pre-change behaviour), run the test, confirm it fails, revert. Also try removing only the `min-h-[…]` class and record honestly whether it fails (with identical DOM it may not; that is expected and should be written in the PR/Notes, not hidden).
- Add "the controls are in the page HTML": `const html = await (await request.get("/shop")).text(); expect(html).toContain('aria-label="Search products"')`. Comment that the dev server does not split shell and hole, so the build-output check (step 12) is what proves the shell part.
- Update the comment above `test.describe("Shop search form", …)`: the search box is now in the shell but disabled until hydration, which is still why the test uses `form.submit()` rather than `javaScriptEnabled: false`.
- Existing tests ("first page is not fetched from the API", sort/search URL tests, "a shared search link streams its results without an API call", empty state + Clear) must stay green unchanged.

### 11. Docs

- `apps/website/ENGINEERING.md` "Shop grid error boundary": say the boundary now sits inside `ShopControls`' grid wrapper around the list's `<Suspense>`, so the controls stay usable on failure. Add one short paragraph (or a sibling section "Shop controls in the static shell") describing the two boundaries and why the fallback repeats the controls.
- `docs/conditional-docs.md`: add conditions to the `feature-86c52a82-shop-debounced-search.md` entry or rely on the document phase; at minimum make sure one entry covers "When changing where `ShopControls` renders, `ShopControlsFallback`, or the `/shop` controls row height".

### 12. Validate

- Run every command in `Validation Commands`. In the build output confirm `/shop` prints the same symbol recorded in step 1.
- Run the Playwright shop spec: `yarn workspace website test:integration e2e/shop.integration.spec.ts` (needs this worktree's dev server port; do not start any other app, do not touch Supabase).

## Test Coverage

- `src/lib/shop/__tests__/pagination.unit.test.ts` (`*.unit.test.ts`): `parseShopParams` / `shopParamsFromSearch` agree for valid, malformed and repeated params; catches the controls showing a different sort or term than the server-rendered list.
- `ShopControls.browser.test.tsx` (`*.browser.test.tsx`): controls take `sort`/`q` from a mocked `useSearchParams` (`?sort=oldest&q=silver`) and fall back to defaults for a malformed URL; the existing debounce/transition/`seenQ` tests prove URL behaviour survived the switch from props to the hook. Fails today because the component has no URL source.
- `ShopResults.browser.test.tsx` (`*.browser.test.tsx`): empty state + Clear and the once-per-term `shop_search_applied` report with its count still work now that they live in the hole and reach the controls through context.
- `ShopControlsFallback.browser.test.tsx` (`*.browser.test.tsx`): fallback and real controls have equal row height and equal grid offset at 390 px and 1280 px, and the fallback's inputs are disabled; catches any drift between the prerendered controls and the hydrated ones (the jump this issue is about).
- `e2e/shop.integration.spec.ts` (`apps/website/e2e/*.spec.ts`): search box and first grid slot keep their position from skeleton to first card at both viewports (plus zero layout shift), and the controls are in the page HTML; the only layer that sees the real Suspense streaming. Negative run documented per step 10.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (the old `ShopControls` props and any now-unused imports are gone)
- `yarn turbo run test --filter=./apps/website` - Unit and chromium browser tests pass, including the new geometry and URL tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and `/shop` shows the same prerender symbol as before the change
- `yarn workspace website test:integration e2e/shop.integration.spec.ts` - Shop e2e (existing #163/#165/#167 steps plus the new layout-stability test) passes

## Notes

- The issue's suggested nesting predates #169; `ShopGridBoundary` now exists, and this plan places it inside `ShopControls` around the inner Suspense only. Putting it outside the outer Suspense would make a failed page one take the controls down with the grid.
- `useSearchParams` makes everything under the outer Suspense dynamic at request time, including the server `children` passed through `ShopControls`. That is fine: the list was already the dynamic hole. The prerendered shell now contains `ShopControlsFallback` + grid skeleton instead of just the skeleton.
- The fallback shows default values (empty box, "Newest first"). For a shared `?sort=oldest&q=teen` link, the prerendered controls briefly show defaults before hydration swaps the URL's values in; same size, so no movement. Not rendering values in the fallback is forced by the static shell and is intended.
- With identical DOM in the fallback, the `min-h-[…]` is belt-and-braces (it guards against font-loading or a future markup divergence). The e2e negative that reliably fails is removing the controls row from the fallback; report the min-h-only negative result truthfully.
- Browser-test harness: mocking `useSearchParams` through a React context (not a module variable) matters, because the navigate state update runs inside a transition and the component must keep seeing the old `q` until it commits.
- Never start dev servers for `telegram-router`/`guest-communication-agent`; never reset the shared Supabase. The website's port comes from `PORT`, not 3000.
