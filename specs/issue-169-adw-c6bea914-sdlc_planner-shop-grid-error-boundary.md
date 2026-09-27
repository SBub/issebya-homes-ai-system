# Feature: Shop product grid error boundary

## Metadata

issue_number: `169`
adw_id: `c6bea914`
issue_json: `{"number":169,"title":"Shop: error boundary around the product grid so a failed first page degrades to a message, not a blank route (follow-up to #163)"}`

## Feature Description

`/shop` renders its grid as `page.tsx` → `<Suspense fallback={<ProductGridSkeleton/>}>` → `ShopProducts` (server, `HydrationBoundary` with the cached first page) → `ProductList` (client, `useSuspenseInfiniteQuery`). In suspense mode TanStack Query throws a first-page error instead of returning it, and nothing in the shop tree catches it, so it climbs past the route and blanks the page.

This feature puts a Sentry `ErrorBoundary` around the grid's `<Suspense>`, inside the `<section aria-label="Products">`. When the grid cannot load, that section shows one calm sentence with a WhatsApp link and a "Try again" button. The error goes to Sentry tagged `area: shop`, `surface: product-grid`. The page shell and the sell link are outside the boundary and keep rendering. Next-page failures are already handled by `ProductList`'s retry line, and that stays as it is.

## User Story

As a visitor browsing the shop
I want a short message and a way to reach the house when the products fail to load
So that I am not left looking at a blank page, and I can retry or get in touch

## Problem Statement

If `ProductList`'s suspense query fails on page one, the error has no boundary in `src/app/(main)/shop/`. The whole route is replaced by whatever sits above it, the visitor loses the header context and the sell link, and the error is not tagged for the shop in Sentry.

## Solution Statement

Reuse the booking engine's pattern (`booking/[type]/page.tsx`, `blog/ui/BookingWidget.tsx`): a Sentry `<ErrorBoundary>` outside a `<Suspense>`. Two details from the codebase change the issue's suggested code:

1. **`page.tsx` is a Server Component, and it cannot pass functions to a Client Component.** Sentry's `ErrorBoundary` is a client component. The booking pages can use it directly from a server file only because their `fallback` is a plain element. Here the fallback must be a render prop (to get `resetError`), and `beforeCapture`/`onReset` are also functions. So the boundary lives in a small `"use client"` wrapper, `shop/ui/ShopGridBoundary.tsx`. `page.tsx` renders `<ShopGridBoundary><Suspense …><ShopProducts /></Suspense></ShopGridBoundary>`. Passing the server `ShopProducts` subtree as `children` through a client component is supported interleaving.
2. **`resetError` on its own does not retry a failed suspense query.** TanStack Query keeps the query in `error` state, and after an error a suspense query does not retry on mount unless its `QueryErrorResetBoundary` has been reset, so it would throw the cached error again at once. `ShopGridBoundary` therefore calls `useQueryErrorResetBoundary()` and passes its `reset` as the Sentry boundary's `onReset`. Sentry calls `onReset` from `resetErrorBoundary()`, which is what `resetError` in the fallback render prop invokes, so one click clears the query error and re-mounts the subtree. This is TanStack's documented pairing of `useQueryErrorResetBoundary` with an error boundary. The hook reads a context that has a default value, so it needs no extra provider; `ShopProviders` (in the shop layout) already supplies the `QueryClient`.

The fallback is `ShopGridError`, a tiny presentational component in `shop/ui/` with no hooks and no `"use client"` directive. It is imported only by `ShopGridBoundary`, so it runs on the client as part of that module graph. It renders the exact copy from the issue in `text-background`, the colour `ProductList`'s retry line already uses on `bg-shop-ground`, with a `<WhatsAppLink />` and a `Try again` button wired to `onRetry`. Because it renders inside the unchanged `bg-shop-ground min-h-screen` section, the layout does not collapse.

`beforeCapture` sets the tags on the scope Sentry passes in: `scope.setTag("area", "shop")` and `scope.setTag("surface", "product-grid")`. This follows the flat tagging style of `src/lib/sentry-booking.ts` (`scope.setTag("flow", "booking")`).

**Server-side path.** When `getProductsPage` throws during the server prefetch, `prefetchInfiniteQuery` swallows the error: it never throws. The failed query is neither `success` nor `pending`, so `shouldDehydrateQuery` leaves it out. `ShopProducts` still renders a `HydrationBoundary`, just an empty one, and the route still returns 200. `ProductList` then has no page one. During SSR its query function (a relative `fetch`) fails, and React's server renderer never uses error boundaries: it emits the nearest `<Suspense>` fallback (the skeleton) and retries on the client. On the client, `ProductList` fetches page one from `/api/shop/products`. If that succeeds the grid appears. If it fails too, the error reaches `ShopGridBoundary` and the fallback shows. So "the page responds 200 with the fallback in the HTML" cannot hold by construction: the fallback is always a client-side outcome, and the HTML carries the skeleton. The plan documents this and covers the client path with a browser test instead of a server-HTML test (see Notes).

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo conventions (yarn only, conventional commits, validation via `--filter=./apps/website`).
- `apps/website/AGENTS.md` - server components by default, `"use client"` only where needed; browser tests are a push/CI gate and must stay component-scoped.
- `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` - how the #163 grid works: the prefetch in a cache scope, dehydrating pending queries, `refetchOnMount: false`, and the rule that a browser test rendering `/shop` must mock `./shop/ui/ShopProducts`.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Server/Client Component boundaries, and passing server children through a client component.
- `apps/website/app_docs/component-patterns-guide.md` - shape of a new small component.
- `apps/website/app_docs/branding-guidelines.md` - house voice for the fallback copy (no bold, no em dashes, no emojis).
- `apps/website/app_docs/testing/component_test_spec_format.md` - browser test format.
- `apps/website/app_docs/testing/e2e_example.md` - Playwright spec conventions.
- `apps/website/src/app/(main)/shop/page.tsx` - the only file that changes structurally: wrap the `<Suspense>` in `<ShopGridBoundary>`.
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` - the server prefetch; read to understand the server-side failure path. Not changed.
- `apps/website/src/app/(main)/shop/ui/ProductList.tsx` - the suspense query that throws on a first-page failure. Not changed (its next-page handling is explicitly out of scope).
- `apps/website/src/app/(main)/shop/ui/ShopProviders.tsx`, `apps/website/src/app/(main)/shop/layout.tsx` - supply the `QueryClient` above the page. Not changed.
- `apps/website/src/lib/shop/query-client.ts` - `makeShopQueryClient()`; client default `retry` is TanStack's 3, so tests must set `retry: false` on the products query (as `ProductList.browser.test.tsx` does).
- `apps/website/src/app/(main)/booking/[type]/page.tsx`, `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` - the existing `ErrorBoundary` + `WhatsAppLink` pattern being reused.
- `apps/website/src/lib/sentry-booking.ts` - tagging style.
- `apps/website/src/app/ui/WhatsAppLink.tsx` - the link rendered in the fallback.
- `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx` - patterns to copy: `next/link`/`next/image`/`posthog-js` mocks, `vi.spyOn(window, "fetch")`, `makeShopQueryClient()` + `setQueryDefaults(SHOP_PRODUCTS_QUERY_KEY, { retry: false })`.
- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx` - renders `ShopIndexPage` with `./shop/ui/ShopProducts` mocked; the new page-level test follows the same approach. Must keep passing, since `page.tsx` now imports a client wrapper that pulls in `@sentry/nextjs` and `@tanstack/react-query`.
- `apps/website/vitest.config.ts` - browser `optimizeDeps.include` already lists `@sentry/nextjs` and `@tanstack/react-query`; verify nothing new is needed.
- `apps/website/e2e/shop.integration.spec.ts` - extended with the next-page-failure guard.
- `docs/conditional-docs.md` - the document phase adds an entry for this feature's app_docs file.

### New Files

- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx` - `"use client"`: Sentry `ErrorBoundary` + `useQueryErrorResetBoundary` + `beforeCapture` tags; renders `ShopGridError` as the fallback.
- `apps/website/src/app/(main)/shop/ui/ShopGridError.tsx` - the fallback: copy, `<WhatsAppLink />`, "Try again" button.
- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx` - browser tests (page-level placement, retry, real-query retry).

## Implementation Plan

### Phase 1: Foundation

Read the Next.js docs in `node_modules/next/dist/docs/` on Server/Client Component composition and error handling, as `apps/website/AGENTS.md` requires. This confirms that function props cannot cross into a client component, and that server rendering falls back to Suspense and does not use error boundaries. Check the installed `@sentry/react` `ErrorBoundary` types (`FallbackRender` gives `{ error, componentStack, eventId, resetError }`; `onReset(error, componentStack, eventId)`; `beforeCapture(scope, error, componentStack)`).

### Phase 2: Core Implementation

Create `ShopGridError` (presentational) and `ShopGridBoundary` (client wrapper). No new dependencies.

### Phase 3: Integration

Wrap the `<Suspense>` in `page.tsx` with `<ShopGridBoundary>`, keeping the section and the sell link outside it. Add the browser tests and run the negative check. Extend the Playwright shop spec with the next-page guard.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs

- Read `apps/website/AGENTS.md`, `app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md`, `app_docs/nextjs-patterns-guide.md`, `app_docs/branding-guidelines.md`, `app_docs/testing/component_test_spec_format.md`.
- Read the relevant Next.js docs under `apps/website/node_modules/next/dist/docs/` (composition patterns / error handling).

### 2. Create `ShopGridError`

- File: `apps/website/src/app/(main)/shop/ui/ShopGridError.tsx`. No `"use client"`, no hooks.
- Props: `{ onRetry: () => void }`.
- Render a `<div role="alert" className="text-center text-sm text-background">` (match `ProductList`'s retry line styling) with:
  - `<p>The shop did not load. Please try again in a moment, or reach us on <WhatsAppLink />.</p>`. Use exactly this copy, with no bold and no em dash.
  - `<button type="button" onClick={onRetry} className="mt-4 border border-background px-6 py-2 text-sm text-background">Try again</button>`. This mirrors the "Load more" button's styling.
- Short doc comment: it is rendered only by `ShopGridBoundary` (client), so it does not need its own directive.

### 3. Create `ShopGridBoundary`

- File: `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx`, `"use client"`.
- Imports: `ErrorBoundary` from `@sentry/nextjs` (destructured, as the booking pages do), `useQueryErrorResetBoundary` from `@tanstack/react-query`, `type ReactNode` from `react`, `ShopGridError`.
- Implementation:
  ```tsx
  export function ShopGridBoundary({ children }: { children: ReactNode }) {
    const { reset } = useQueryErrorResetBoundary();
    return (
      <ErrorBoundary
        onReset={reset}
        beforeCapture={(scope) => {
          scope.setTag("area", "shop");
          scope.setTag("surface", "product-grid");
        }}
        fallback={({ resetError }) => <ShopGridError onRetry={resetError} />}
      >
        {children}
      </ErrorBoundary>
    );
  }
  ```
- Doc comment, in the style of `ShopProducts`/`ProductList`, covering three points:
  - Why this is a client wrapper: `page.tsx` is a Server Component and cannot pass the fallback render prop or `beforeCapture` across the boundary.
  - Why `onReset={reset}`: without it, a suspense query that has failed rethrows its cached error on re-mount, so "Try again" would do nothing.
  - That only first-page errors reach it, because `ProductList` handles next-page errors itself.

### 4. Wire it into `page.tsx`

- In `apps/website/src/app/(main)/shop/page.tsx`, wrap the existing `<Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}><ShopProducts /></Suspense>` in `<ShopGridBoundary>`. The `<section aria-label="Products" className="bg-shop-ground … min-h-screen">` stays the outer element, and the sell link `<p>` stays outside both.
- Extend the existing page comment in one sentence: the boundary sits outside the `<Suspense>` so a first-page error thrown from inside the suspended tree replaces only the grid.
- Do not add `shop/error.tsx`. Do not touch `ProductList`.
- Confirm `page.tsx` still reads nothing from the request (static shell unchanged).

### 5. Browser tests: `ShopGridBoundary.browser.test.tsx`

- Location: `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx`.
- Mocks, copied from `ProductList.browser.test.tsx`: `next/link`, `next/image`, `posthog-js` (`WhatsAppLink` captures on click). Mock `./ShopProducts` with a `vi.hoisted` controllable component, as `index-pages-no-title-heading.browser.test.tsx` does, because the real one pulls in `next/cache`.
- Silence the expected React/Sentry console errors for thrown-error tests: `vi.spyOn(console, "error").mockImplementation(() => {})`, restored in `afterEach`.
- Test A, **page placement**: `ShopProducts` mock always throws. Render `<ShopIndexPage />` (imported from `../page`). Assert:
  - `getByRole("region", { name: "Products" })` contains the text `The shop did not load. Please try again in a moment, or reach us on`, and a link named `WhatsApp (+351 920 742 845)` with `href="https://wa.me/351920742845"`.
  - The sell link (`SELL_LINK_LABEL`, `href="/shop/sell"`) is visible **outside** the region.
  - A `Try again` button is present.
- Test B, **reset re-renders the child**: the `ShopProducts` mock throws on its first render and then returns `<p>Grid loaded</p>` (a module-level flag). Render `<ShopIndexPage />`, click `Try again`, and assert `Grid loaded` is visible and the fallback text is gone. Throw on the first _render attempt_ only, keyed on a flag the mock flips, so React's retry-on-error render does not turn "once" into "twice". If React 19 re-renders once after an error, gate on a counter the test controls: set `shouldThrow = false` just before clicking.
- Test C, **real suspense query recovers** (proves `onReset={reset}`): render `<QueryClientProvider client={client}><ShopGridBoundary><Suspense fallback={<p>loading</p>}><ProductList /></Suspense></ShopGridBoundary></QueryClientProvider>`. `client = makeShopQueryClient()` with `setQueryDefaults(SHOP_PRODUCTS_QUERY_KEY, { retry: false })`, and no hydrated page one. Stub `window.fetch`: first call → `new Response(null, { status: 500 })`, then a 200 JSON `selectPage(products, null, 6)`. Assert the fallback shows. Click `Try again`. Assert product cards render and `fetch` was called twice. This test fails if `onReset={reset}` is removed, so run that removal too as a second negative check and revert.
- **Negative check (required by the issue)**: temporarily replace `<ShopGridBoundary>` in `page.tsx` with a fragment and run the suite. Tests A and B must fail (the throw escapes `render`). Revert, and record in the implementation report that this was tried and reverted, with the failing output summary.
- Keep the suite small (three tests) per `apps/website/AGENTS.md` push-cost guidance.

### 6. Check `index-pages-no-title-heading.browser.test.tsx` still passes

- It renders `ShopIndexPage` with `ShopProducts: () => null`. The page now imports `ShopGridBoundary` (Sentry + TanStack), and both are already in `optimizeDeps.include`. Run it; no change is expected.

### 7. Playwright guard in `e2e/shop.integration.spec.ts`

- Add one test to the existing `Shop` describe: `page.route("**/api/shop/products**", (r) => r.fulfill({ status: 500 }))`, `goto("/shop")`, confirm six cards (page one comes from the prerendered shell, so it is unaffected), click `Load more`. Assert:
  - The `Couldn't load more products.` retry line is visible.
  - The six cards remain.
  - `The shop did not load` is **not** visible.
- This guards the contract that next-page failures do not escalate to the grid boundary. Stated honestly: it would pass without this feature too. It is a regression guard for the boundary's scope, not a proof of the fallback. The first-page fallback cannot be induced in the Playwright run: page one is baked into the prerendered static shell, and there is no `E2E_MOCK_*` hook for `getProductsPage`. The browser tests in step 5 carry that proof.

### 8. Run the validation commands

- Run every command in `Validation Commands` and fix anything red.

## Testing Strategy

### Unit Tests

No new `*.unit.test.ts`. There is no pure logic to test: the change is component wiring. The `beforeCapture` tag values are two literal `setTag` calls. Asserting them would mean either initialising a Sentry client with a test transport in the browser pool or exporting the callback only for a test, and neither pays for itself. They are verified by review and, after deploy, by the tags on a real event.

### Test Coverage

- `src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx`, test A (`*.browser.test.tsx`): catches a first-page grid error blanking `/shop`. Asserts the fallback copy and WhatsApp link render inside the Products region while the sell link outside it survives. Fails without the boundary in `page.tsx` (negative check run and reverted).
- Same file, test B (`*.browser.test.tsx`): catches "Try again" not re-rendering the grid (a full reload, or a missing `resetError` wiring).
- Same file, test C (`*.browser.test.tsx`): catches "Try again" being a no-op for the real `useSuspenseInfiniteQuery`, because a failed suspense query rethrows its cached error unless `QueryErrorResetBoundary.reset` runs. Fails without `onReset={reset}`.
- `apps/website/e2e/shop.integration.spec.ts`, new next-page-failure test (`e2e/*.spec.ts`): catches a future change that lets next-page errors escalate to the grid fallback. It does not fail without this feature. It is a scope guard, and it is not a CI gate (the e2e suite runs only in the ADW test phase).

### Edge Cases

- Next-page failure: `ProductList`'s own retry line shows, the boundary does not trigger, and loaded cards stay (Playwright guard).
- Retry fails again: the fallback re-appears (the boundary catches again). This is covered implicitly by the Sentry boundary semantics, and the tests could extend test C with a second 500 if it is cheap.
- Server prefetch failure: the HTML carries the skeleton (not the fallback), the client fetches page one, and the fallback appears only if that fails too (see Notes).
- Sentry not initialised (tests, local without DSN): the boundary still renders the fallback, and capture is a no-op.
- Navigating to a product and back after a failure: the query cache lives in `ShopProviders` (layout), and the error resets on "Try again" or when the query is garbage-collected. No special handling.

## Acceptance Criteria

- `/shop/page.tsx` renders `<section aria-label="Products">` → `<ShopGridBoundary>` → `<Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}>` → `<ShopProducts />`, and the sell link remains outside the boundary.
- A first-page grid error shows, inside the grey `bg-shop-ground` section: `The shop did not load. Please try again in a moment, or reach us on WhatsApp (+351 920 742 845).` plus a `Try again` button. There is no bold, no em dash and no emoji.
- `Try again` calls the boundary's `resetError` (no page reload), which also resets TanStack's query error boundary, so the grid re-fetches and renders on success.
- Errors caught by the boundary carry the Sentry tags `area=shop` and `surface=product-grid`.
- No `src/app/(main)/shop/error.tsx` exists, and `ProductList.tsx` is unchanged.
- `/shop` is still prerendered (the build output shows it static / partially prerendered as before).
- The three new browser tests pass. The negative check (boundary removed → A and B fail; `onReset` removed → C fails) was run and reverted.
- All validation commands are green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser (chromium) tests pass, including `ShopGridBoundary.browser.test.tsx` and the unchanged `ProductList`/`index-pages-no-title-heading` suites
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and `/shop` still prerenders

## Notes

- **No new dependencies.** `@sentry/nextjs` and `@tanstack/react-query` are already installed and already in the browser project's `optimizeDeps.include`.
- **Deviation from the issue's suggested code:** the boundary is a client wrapper (`ShopGridBoundary`) rather than an inline `<ErrorBoundary fallback={({ resetError }) => …}>` in `page.tsx`. The inline form would fail at build/render time because a Server Component cannot pass functions (`fallback` render prop, `beforeCapture`) to a Client Component. The rendered tree and placement match the issue.
- **Server-side verification item:** the issue asks for a test that mocks `getProductsPage` to throw and asserts a 200 with the fallback in the HTML. That outcome cannot happen with this architecture. `prefetchInfiniteQuery` never throws, and a failed query is not dehydrated. React SSR never renders error-boundary fallbacks: it falls back to the Suspense skeleton and lets the client retry. The route returns 200 with the skeleton, and the fallback only ever appears client-side after the browser's page-one fetch also fails. That client path is what the browser tests cover. The implementation report should restate this for the owner.
- **Pre-existing risk worth a follow-up issue (out of scope here):** because `getFirstPageState()` is `"use cache"` with `cacheLife("days")` and the prefetch swallows errors, a transient server failure caches an _empty_ dehydrated state for up to a day. During that time every visitor fetches page one from the browser, which is the fetch the prefetch exists to avoid. Throwing from `getFirstPageState` when the query ended in error (so the failure is not cached) would fix it, but that changes #163's cache behaviour and belongs in its own issue.
- **Contrast:** `WhatsAppLink` uses `text-secondary-link-bold`, a bold style, on the `#6f6f6f` shop ground. The issue says "no bold" for the copy. The link's own bold weight is the shared component's style, as on the booking pages, and is kept. If the owner wants it plain on this surface, that is a one-prop follow-up to `WhatsAppLink`, not something to fork here. Check legibility on the preview.
- **Manual preview check (owner):** block `/api/shop/products` in DevTools and scroll. The next-page retry line should appear, with no grid fallback. The first-page path is covered by the browser tests.
- The issue carries `adw:hold`: this stacks on #163's branch (PR #164), and the owner previews before merge.
