# Feature: Shop product grid error boundary

## Metadata

issue_number: `169`
adw_id: `12e4efa7`
issue_json: `{"number":169,"title":"Shop: error boundary around the product grid so a failed first page degrades to a message, not a blank route (follow-up to #163)"}`

## Feature Description

`/shop` renders its grid as `page.tsx` → `<Suspense fallback={<ProductGridSkeleton/>}>` → `ShopProducts` (async Server Component: reads `searchParams`, calls `getProductsPage`, prefetches page one into a `HydrationBoundary`) → `ProductList` (client, `useSuspenseInfiniteQuery`). In suspense mode React Query throws a first-page failure instead of returning it, and a throw inside the async Server Component (for example `getProductsPage` failing against Supabase) is streamed to the client as an errored RSC chunk that throws when rendered. Neither has a boundary in the shop tree, so the error climbs to whatever is above and blanks the route.

This feature wraps the grid's `<Suspense>` in Sentry's `ErrorBoundary`, so a first-page failure renders one calm sentence, a WhatsApp link and a "Try again" button inside the same `bg-shop-ground` section, reports to Sentry tagged `area: shop`, `surface: product-grid`, and leaves the page shell and the sell link rendering.

## User Story

As a visitor browsing the shop
I want to see a short message and a way to reach the house when the products cannot load
So that I am not left looking at a blank page and can still get in touch or retry

## Problem Statement

There is no error boundary between the shop grid and the app root. A failure loading page one (server-side in `ShopProducts`, or client-side in `ProductList`'s suspense query) propagates past the shop tree, taking the whole route down, and the owner has no shop-tagged signal in Sentry.

## Solution Statement

Reuse the existing booking pattern (`blog/ui/BookingWidget.tsx`, `booking/[type]/page.tsx`: Sentry `<ErrorBoundary>` outside `<Suspense>`, message plus `<WhatsAppLink />`), with two additions the issue asks for: a "Try again" button driven by the boundary's `resetError`, and `beforeCapture` tags.

One structural consequence the issue's suggestion glosses over: `page.tsx` is a Server Component, and both `fallback={({ resetError }) => …}` and `beforeCapture={…}` are functions, which cannot be passed from a Server Component to Sentry's client `ErrorBoundary` (functions are not serialisable across the RSC boundary; the booking callers get away with it only because they pass a plain element fallback and no callbacks). So the boundary lives in a small `"use client"` wrapper, `ShopGridBoundary`, in `shop/ui/`. `page.tsx` renders `<ShopGridBoundary><Suspense …><ShopProducts …/></Suspense></ShopGridBoundary>` inside the existing `<section aria-label="Products">`; the server children pass through the client wrapper as `children`, which is allowed.

Retry must actually retry, for both failure origins:

- **Client-originated** (the suspense query rejected): React Query keeps the query in its error state and a remount would re-throw the cached error unless its error reset boundary is cleared. The wrapper calls `useQueryErrorResetBoundary()` and passes its `reset` as the Sentry boundary's `onReset`, so `resetError()` clears the boundary and lets the query refetch.
- **Server-originated** (`ShopProducts` threw): `resetError()` alone re-renders the same errored RSC chunk and throws again. The retry handler therefore runs `startTransition(() => { router.refresh(); resetError(); })`, the documented pattern for recovering from a Server Component error without a full reload (it is what Next's own `unstable_retry` does). `router.refresh()` re-requests the route's RSC payload; the shell and client state outside the boundary are preserved.

The fallback UI is `ShopGridError` (`shop/ui/ShopGridError.tsx`), a plain presentational component taking `onRetry`. It has no hooks or directive of its own; it is only ever rendered from `ShopGridBoundary`, so it runs on the client there.

`ProductList`'s next-page handling is unchanged: `fetchNextPage` failures and background refetch failures do not throw in suspense mode while data exists, so they still surface as the existing retry line, not the new fallback.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo conventions (yarn only, conventional commits, filter by path).
- `apps/website/AGENTS.md` - server-by-default, `'use client'` only where needed; browser tests are gated on push and in CI, keep them component-scoped; the Playwright `e2e/` suite is not in CI.
- `apps/website/ENGINEERING.md` - why pages render the way they do; add a short note on the shop grid boundary.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Server/Client component split (the reason for the client wrapper).
- `apps/website/app_docs/component-patterns-guide.md` - component conventions.
- `apps/website/app_docs/branding-guidelines.md` - house voice for the fallback copy (no bold, no em dashes, no emojis).
- `apps/website/app_docs/testing/component_test_spec_format.md` - browser test format.
- `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md` - background on the suspense infinite list this protects.
- `apps/website/src/app/(main)/shop/page.tsx` - where the boundary is placed, around the `<Suspense>`, inside the `<section aria-label="Products">`; the sell link stays outside.
- `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` - the async Server Component whose throw is the server-side failure path.
- `apps/website/src/app/(main)/shop/ui/ProductList.tsx` - `useSuspenseInfiniteQuery`; its next-page retry line must not change.
- `apps/website/src/app/(main)/shop/ui/ShopProviders.tsx` - the `QueryClientProvider` above the page (from the shop layout), so `useQueryErrorResetBoundary` works in the wrapper.
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx` - the Suspense fallback, unchanged.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx`, `apps/website/src/app/(main)/booking/[type]/page.tsx` - the Sentry `ErrorBoundary` + `WhatsAppLink` pattern being reused.
- `apps/website/src/lib/sentry-booking.ts` - tagging style (`scope.setTag`).
- `apps/website/src/app/ui/WhatsAppLink.tsx` - the link rendered in the fallback (client component, captures a PostHog event on click).
- `apps/website/src/app/(main)/shop/ui/ShopControls.browser.test.tsx`, `apps/website/src/app/(main)/shop/ui/ProductList.browser.test.tsx` - patterns for mocking `next/navigation`, `posthog-js` and rendering with `vitest-browser-react`.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` - Next 16.2 retry semantics (read before coding, per the workspace rule).
- `node_modules/@sentry/react/build/types/errorboundary.d.ts` - `fallback` render prop (`{ error, componentStack, eventId, resetError }`), `onReset`, `beforeCapture(scope, error, componentStack)`.

### New Files

- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx` - `"use client"` wrapper: Sentry `ErrorBoundary` with render-prop fallback, `onReset` wired to React Query's error reset, `beforeCapture` tags, retry via `router.refresh()` + `resetError()` in a transition.
- `apps/website/src/app/(main)/shop/ui/ShopGridError.tsx` - the fallback content (copy, WhatsApp link, "Try again" button).
- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx` - component-scoped browser test.
- `apps/website/app_docs/feature-12e4efa7-shop-grid-error-boundary.md` - feature doc (written by the document phase, indexed in `docs/conditional-docs.md`).

## Implementation Plan

### Phase 1: Foundation

Read the Next 16.2 error-handling docs and the Sentry `ErrorBoundary` type definitions in `node_modules` to confirm the render-prop signature and `onReset` semantics. Confirm `ShopProviders` (the `QueryClientProvider`) is mounted by `shop/layout.tsx`, above the page.

### Phase 2: Core Implementation

Build `ShopGridError` (presentational) and `ShopGridBoundary` (client wrapper) in `shop/ui/`.

### Phase 3: Integration

Wrap the `<Suspense>` in `page.tsx` with `ShopGridBoundary`, update the page comment, add the browser test with its negative check, and record the design in `ENGINEERING.md`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs the workspace rules require

- `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md` and `.../03-file-conventions/error.md` (retry semantics, why a plain reset does not re-fetch Server Component output).
- `node_modules/@sentry/react/build/types/errorboundary.d.ts` for the exact prop types.

### 2. Create `ShopGridError`

- File `apps/website/src/app/(main)/shop/ui/ShopGridError.tsx`, exported `ShopGridError({ onRetry }: { onRetry: () => void })`.
- Renders exactly: `The shop did not load. Please try again in a moment, or reach us on <WhatsAppLink />.` in a `<p>` (plain text, no bold, no em dashes, no emojis), followed by a `<button type="button" onClick={onRetry}>Try again</button>` styled like the shop's existing text buttons (match `ProductList`'s next-page retry control's classes so the two read as one voice).
- Give the wrapper `role="alert"` so assistive tech announces the failure, and enough min-height/padding that the `bg-shop-ground` section does not collapse (the section itself already carries `min-h-screen`; keep the fallback inside it).
- No `"use client"` directive: it is only imported by `ShopGridBoundary`, which is a client module. Add a one-line comment saying so.

### 3. Create `ShopGridBoundary`

- File `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx`, `"use client"`, exported `ShopGridBoundary({ children }: { children: ReactNode })`.
- `const router = useRouter()` (`next/navigation`), `const { reset } = useQueryErrorResetBoundary()` (`@tanstack/react-query`), `const [, startTransition] = useTransition()` (or the `startTransition` import from `react`).
- Render:
  ```tsx
  <ErrorBoundary
    beforeCapture={(scope) => {
      scope.setTag("area", "shop");
      scope.setTag("surface", "product-grid");
    }}
    onReset={reset}
    fallback={({ resetError }) => (
      <ShopGridError
        onRetry={() =>
          startTransition(() => {
            router.refresh();
            resetError();
          })
        }
      />
    )}
  >
    {children}
  </ErrorBoundary>
  ```
- `ErrorBoundary` imported destructured from `@sentry/nextjs` (import-patterns guide), as the booking callers do.
- JSDoc explaining: why a client wrapper (function props cannot cross from the server `page.tsx`), why the boundary sits outside `<Suspense>`, why `onReset` clears React Query's error reset boundary (client-originated failures) and why `router.refresh()` accompanies `resetError()` (server-originated failures re-throw the same RSC chunk otherwise), and that next-page failures never reach it.

### 4. Place the boundary in `page.tsx`

- In `apps/website/src/app/(main)/shop/page.tsx`, wrap the existing `<Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}>…</Suspense>` in `<ShopGridBoundary>`, inside the `<section aria-label="Products">`. The outer `<div>`, the section, and the sell link `<p>` stay outside the boundary.
- `page.tsx` stays a Server Component with no new request reads, so the shell stays static.
- Extend the page comment by one sentence: the grid has its own error boundary, so a failed page one degrades to a message inside the section while the rest of the page renders.
- Do not add `shop/error.tsx`. Do not touch `ProductList.tsx`.

### 5. Browser test `ShopGridBoundary.browser.test.tsx`

- Model on `ShopControls.browser.test.tsx` / `ProductList.browser.test.tsx`: `vi.mock("next/navigation", …)` with a `useRouter` returning `{ refresh: mockRefresh }`, `vi.mock("posthog-js", …)` (`WhatsAppLink` imports it), and `vi.mock("@sentry/nextjs", async (orig) => ({ ...(await orig()), captureException: vi.fn() }))` only if the real module misbehaves in the browser pool; prefer the real `ErrorBoundary` so the test exercises the component actually shipped. Wrap renders in a `QueryClientProvider` with `makeShopQueryClient()` (required by `useQueryErrorResetBoundary`).
- Render a fixture mirroring the page: `<section aria-label="Products"><ShopGridBoundary><Suspense fallback={…}><Child/></Suspense></ShopGridBoundary></section><p>…<a href="/shop/sell">…</a></p>`.
- Test 1, "a throwing grid degrades to the message and keeps the sell link": `Child` always throws. Expect the fallback sentence (`The shop did not load. Please try again in a moment, or reach us on`), a link with `href` `https://wa.me/351920742845`, the "Try again" button, and the sell link all visible.
- Test 2, "Try again re-renders the grid": `Child` throws on the first render and succeeds after (module-level flag flipped by the first throw, reset in `beforeEach`), rendering `Products loaded`. Click "Try again" → `Products loaded` visible, fallback gone, `mockRefresh` called once.
- Test 3, "a failed suspense query recovers on retry": a `Child` using `useSuspenseQuery` with a `queryFn` that rejects the first call and resolves the second (`retry: false` on that query). Expect the fallback, click "Try again", expect the resolved content. This is the case that fails without `onReset={reset}` (the query re-throws its cached error on remount).
- Silence React's expected error logging for thrown-render tests with a `console.error` spy restored in `afterEach`, as existing tests do if they have that pattern; otherwise add one locally.
- Negative check (manual, during implementation, then reverted): replace `ShopGridBoundary` with a pass-through fragment and confirm Tests 1 and 2 fail (the throw escapes the render), and remove `onReset={reset}` and confirm Test 3 fails. Record both in the PR description as "tried and reverted".

### 6. Server-side first-page failure path

- The async `ShopProducts` (with `"use cache"`, `cacheTag`, `cacheLife` and `PageProps<"/shop">`) cannot be rendered by Vitest's node or browser pools; there is no RSC renderer in the harness, so the "mock `getProductsPage` to throw and assert a 200 with the fallback in the HTML" check is not exercisable there. State this in the PR.
- It is also not a cheap Playwright case: page one is fetched inside the Next server process from Supabase, invisible to `page.route()`, and would need a new `E2E_MOCK_*` failure toggle in `src/instrumentation.ts` plus a cache-busting route like `api/e2e-ical-mock` (because `getFirstPageState` is `"use cache"`). That is disproportionate for a boundary whose client behaviour the browser test already proves, and it would not run in CI anyway. Note the expected server behaviour instead: on a server throw, the HTML streams with the skeleton (React switches that Suspense boundary to client rendering), then the client renders the errored chunk, the boundary catches it and shows the fallback; the HTTP status stays 200 because the shell was already sent.
- Manual verification on the preview (for the reviewer, listed in the PR): block `/api/shop/products` in DevTools and scroll → the existing next-page retry line appears, not the new fallback.

### 7. Documentation

- Add a short "Shop grid error boundary" paragraph to `apps/website/ENGINEERING.md` next to the existing shop notes (or the rendering section): boundary placement, the client-wrapper reason, the two-origin retry, and that `error.tsx` is deliberately absent for the shop.

### 8. Playwright spec: none

- No new `apps/website/e2e/` spec. The only first-page failure an e2e run could reach needs a server-side failure injection that does not exist (see step 6); the success path is already covered by `e2e/shop.integration.spec.ts`, which must stay green (it proves the boundary is transparent when nothing fails).

### 9. Run the Validation Commands

- Run every command in `Validation Commands` and fix anything red.

## Testing Strategy

### Unit Tests

No `*.unit.test.ts`: there is no pure logic here. The behaviour is React error-boundary rendering and a click handler, which needs a real DOM.

### Test Coverage

- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx` (`*.browser.test.tsx`, gated on push and in CI):
  - a throwing grid child renders the fallback copy, WhatsApp link and "Try again", and the sell link outside still renders; catches the route going blank on a first-page failure (fails today: nothing catches the throw).
  - "Try again" re-renders the child (throws once, then succeeds) and calls `router.refresh()`; catches a retry that does nothing or reloads the page.
  - a rejected `useSuspenseQuery` recovers after "Try again"; catches forgetting React Query's error reset, which would leave the fallback stuck.
- Existing `e2e/shop.integration.spec.ts` (run by the test phase) guards that the boundary does not change the happy path.

### Edge Cases

- Error thrown by the async Server Component (not the client query): retry must `router.refresh()`, not only reset.
- Error from `useSuspenseInfiniteQuery` on page one after a sort/search change whose prefetch did not arrive: retry must clear React Query's error state.
- Next-page failure (`isFetchNextPageError`): must still show `ProductList`'s own retry line, never the fallback.
- A retry that fails again: fallback re-appears and Sentry receives another event (expected; no loop, since retry is user-initiated).
- Client navigation between sort/search variants after an error: the boundary is in `page.tsx`, the same page instance, so the fallback persists until "Try again"; acceptable and matches the issue's intent. Navigating to `/shop/[slug]` unmounts it.
- Sell link and page header keep rendering in every case.

## Acceptance Criteria

- `page.tsx` wraps the grid's `<Suspense>` in `ShopGridBoundary` (a Sentry `ErrorBoundary`), inside `<section aria-label="Products">`; the sell link is outside it.
- On a first-page failure the section shows exactly `The shop did not load. Please try again in a moment, or reach us on WhatsApp (+351 920 742 845).` (the link text coming from `<WhatsAppLink />`) and a "Try again" button, with no bold, em dashes or emojis.
- "Try again" uses the boundary's `resetError` (plus `router.refresh()` in a transition and React Query's error reset), not `window.location.reload()`.
- Sentry events from the boundary carry tags `area: shop` and `surface: product-grid`.
- No `shop/error.tsx` added; `ProductList.tsx` unchanged.
- The new browser test passes, and fails with the boundary removed (tried and reverted, stated in the PR).
- All validation commands are green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, including `ShopGridBoundary.browser.test.tsx`
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and `/shop` still prerenders its static shell

## Notes

- No new dependencies: `@sentry/nextjs`, `@tanstack/react-query` and `next/navigation` are already in use.
- The issue's suggested snippet puts function props on `ErrorBoundary` directly in `page.tsx`; that cannot work from a Server Component, hence the client wrapper. `ShopGridError` stays a hook-free presentational component, which satisfies the "tiny server-safe component" intent.
- Next 16.2 also offers `unstable_catchError` from `next/error` with built-in `unstable_retry`, which would handle the server-origin retry natively. Not used here because the issue requires Sentry's boundary for reporting, and the API is still `unstable_`. Worth revisiting when it stabilises.
- Server-side errors are also captured by `captureRequestError` via `instrumentation.ts`'s `onRequestError`; the boundary's client event is the one carrying the shop tags. In production the client-side error message is redacted to a digest, which is expected.
- This applies on top of #163's branch and carries `adw:hold`; the owner previews before merge.
