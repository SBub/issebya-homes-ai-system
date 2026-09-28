# Shop product grid error boundary

**ADW ID:** 12e4efa7
**Date:** 2026-09-28
**Specification:** specs/issue-169-adw-12e4efa7-sdlc_planner-shop-grid-error-boundary.md

## Overview

`/shop` now has an error boundary around its product grid. If page one fails to load, either on the server (`ShopProducts` throws) or on the client (`ProductList`'s suspense query rejects), the products section shows one calm sentence, a WhatsApp link and a "Try again" button instead of the whole route going blank. The page shell and the sell link keep rendering, and the failure reaches Sentry tagged `area: shop`, `surface: product-grid`.

## What Was Built

- `ShopGridBoundary`: a `"use client"` wrapper around Sentry's `ErrorBoundary`, with a render-prop fallback, `beforeCapture` tags, React Query's error reset wired to `onReset`, and a retry that runs `router.refresh()` plus `resetError()` in one transition
- `ShopGridError`: the presentational fallback (`role="alert"`), copy `The shop did not load. Please try again in a moment, or reach us on <WhatsAppLink />.` and a "Try again" button
- `page.tsx` wraps the grid's existing `<Suspense>` in `ShopGridBoundary`, inside `<section aria-label="Products">`; the sell link stays outside
- A component-scoped browser test covering the throw, the retry and a rejected suspense query recovering

## Technical Implementation

### Files Modified

- `src/app/(main)/shop/ui/ShopGridBoundary.tsx` (new): the client boundary described above.
- `src/app/(main)/shop/ui/ShopGridError.tsx` (new): fallback content, no hooks and no directive (it is only rendered from the client wrapper).
- `src/app/(main)/shop/page.tsx`: `<ShopGridBoundary>` around the `<Suspense>`, plus one sentence in the page comment.
- `src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx` (new): three browser tests.
- `src/app/(main)/index-pages-no-title-heading.browser.test.tsx`: mocks `ShopGridBoundary` as a pass-through, since `@sentry/nextjs` reads `process` at import time in the browser pool.
- `package.json`, `vitest.config.ts`: `@sentry/react` (pinned to the version `@sentry/nextjs` re-exports) added as a devDependency and to the browser pool's `optimizeDeps`, so the test can use the real `ErrorBoundary` without importing `@sentry/nextjs`.
- `ENGINEERING.md`: new "Shop grid error boundary" section.

### Key Changes

- **Why a client wrapper:** the fallback render prop and `beforeCapture` are functions, and a Server Component (`page.tsx`) cannot pass functions to a client component. The server children (`Suspense` → `ShopProducts`) pass through the wrapper as `children`, which is allowed.
- **Placement:** the boundary sits outside `<Suspense>`, so it catches a throw from anything under it, and inside the `bg-shop-ground` section, so the fallback keeps the section's look and height.
- **Client-side retry:** a rejected suspense query stays in React Query's error state and would re-throw on remount. `onReset={reset}` (from `useQueryErrorResetBoundary`) clears it so the query refetches.
- **Server-side retry:** resetting alone re-renders the same errored RSC chunk. The retry runs `startTransition(() => { router.refresh(); resetError(); })`, the same pattern as Next's `unstable_retry`, which re-requests the route payload without a full reload.
- **Unchanged:** next-page and background refetch failures do not throw in suspense mode while data exists, so `ProductList` still shows its own retry line for them. There is deliberately no `shop/error.tsx`.

## How to Use

1. Open `/shop`. When nothing fails, the boundary is invisible.
2. If page one fails, the products section shows the message, a WhatsApp link and "Try again".
3. "Try again" refreshes the route's server payload and re-renders the grid; if it fails again the fallback returns and Sentry gets another event.
4. In Sentry, filter on `area:shop surface:product-grid` to find these events.

## Configuration

None. `@sentry/nextjs`, `@tanstack/react-query` and `next/navigation` were already in use; `@sentry/react` is a test-only devDependency.

## Testing

- `yarn turbo run test --filter=./apps/website` runs `ShopGridBoundary.browser.test.tsx`:
  - a throwing grid renders the fallback copy, the WhatsApp link (`https://wa.me/351920742845`) and "Try again", and the sell line outside still renders
  - "Try again" re-renders a grid that failed once and calls `router.refresh()`
  - a `useSuspenseQuery` that rejects once recovers after "Try again" (fails without `onReset={reset}`)
- `e2e/shop.integration.spec.ts` guards that the happy path is unchanged.
- Manual: block `/api/shop/products` in DevTools and scroll; the existing next-page retry line should appear, not this fallback.

## Notes

- The server-side failure path (`ShopProducts` throwing) is not covered by an automated test: Vitest has no RSC renderer, and a Playwright case would need a new server-side failure toggle plus cache busting around the `"use cache"` page-one fetch. Expected behaviour: the HTML streams with the skeleton, the client renders the errored chunk, the boundary shows the fallback, and the HTTP status stays 200.
- Server errors are also captured by `onRequestError` in `instrumentation.ts`; the boundary's client event is the one with the shop tags. In production the client-side message is redacted to a digest.
- After an error, client navigation between sort/search variants keeps the fallback until "Try again" (same page instance). Navigating to `/shop/[slug]` unmounts it.
- Next 16.2's `unstable_catchError` with built-in `unstable_retry` could replace the manual refresh once it stabilises; not used because the issue requires Sentry's boundary for reporting.
