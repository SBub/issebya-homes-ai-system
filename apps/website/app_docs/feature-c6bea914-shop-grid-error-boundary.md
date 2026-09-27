# Shop Grid Error Boundary

**ADW ID:** c6bea914
**Date:** 2026-09-27
**Specification:** specs/issue-169-adw-c6bea914-sdlc_planner-shop-grid-error-boundary.md

## Overview

`ProductList` on `/shop` uses `useSuspenseInfiniteQuery`, which throws a first-page error instead of returning it. Before this change nothing in the shop tree caught it, so the error climbed past the route and blanked the page. The grid is now wrapped in a Sentry `ErrorBoundary` (issue #169, a follow-up to #163): a failed first page shows one calm sentence, a WhatsApp link and a "Try again" button inside the Products section, while the page shell and the sell link keep rendering.

## What Was Built

- `ShopGridBoundary`, a small `"use client"` wrapper around Sentry's `ErrorBoundary`, placed outside the grid's `<Suspense>` and inside `<section aria-label="Products">`
- `ShopGridError`, the fallback: "The shop did not load. Please try again in a moment, or reach us on WhatsApp (+351 920 742 845)." plus a `Try again` button
- "Try again" resets both the Sentry boundary and TanStack Query's error reset boundary, so a failed suspense query really refetches
- Caught errors are tagged in Sentry with `area=shop` and `surface=product-grid`
- Three browser tests (page placement, reset re-render, real suspense-query recovery) and a Playwright scope guard for next-page failures

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx` (new): `ErrorBoundary` from `@sentry/nextjs` with `onReset={reset}` from `useQueryErrorResetBoundary()`, a `beforeCapture` that sets the two tags, and a render-prop fallback that passes `resetError` to `ShopGridError`
- `apps/website/src/app/(main)/shop/ui/ShopGridError.tsx` (new): presentational fallback, no hooks and no directive (it is only imported by the client wrapper). Styled `text-background` on the grey `bg-shop-ground`, like `ProductList`'s retry line; the button mirrors "Load more"
- `apps/website/src/app/(main)/shop/page.tsx`: wraps the existing `<Suspense fallback={<ProductGridSkeleton …/>}>` in `<ShopGridBoundary>`. The section and the sell link stay outside it
- `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.browser.test.tsx` (new): the three browser tests
- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx`: mocks `./shop/ui/ShopGridBoundary` as a pass-through
- `apps/website/e2e/shop.integration.spec.ts`: new test, a 500 on `/api/shop/products` after "Load more" keeps the six cards and the retry line, and never shows the grid fallback
- `apps/website/package.json`, `apps/website/vitest.config.ts`, `yarn.lock`: `@sentry/react` (pinned to the version `@sentry/nextjs` uses) as a devDependency, and added to the browser project's `optimizeDeps.include`

### Key Changes

- **Client wrapper, not an inline boundary.** `page.tsx` is a Server Component and cannot pass functions (the fallback render prop, `beforeCapture`) to a Client Component. The server `ShopProducts` subtree still passes through as `children`, and the page stays a static shell.
- **`onReset={reset}` is required.** A failed suspense query rethrows its cached error on re-mount until its `QueryErrorResetBoundary` is reset. Without it, "Try again" would drop straight back into the fallback. Sentry calls `onReset` from `resetError`, so one click clears both.
- **Only first-page errors reach the boundary.** Next-page errors are still handled by `ProductList`'s own "Couldn't load more products." line, and loaded cards stay.
- **The fallback is always a client-side outcome.** If the server prefetch fails, `prefetchInfiniteQuery` swallows it and the failed query is not dehydrated. React SSR never renders error-boundary fallbacks, so the HTML carries the skeleton and the client fetches page one itself. The fallback appears only if that browser fetch fails too.
- **Tests mock `@sentry/nextjs` with `@sentry/react`'s `ErrorBoundary`.** The real `@sentry/nextjs` client entry imports `next/router`, which reads `process` at import time in the browser pool. Its `ErrorBoundary` is a re-export of `@sentry/react`'s, so the boundary under test is still Sentry's own.

## How to Use

1. Visit `/shop`. Normally nothing changes: page one arrives with the prerendered shell.
2. If the first page fails to load in the browser, the Products section shows the fallback message with a WhatsApp link and `Try again`.
3. `Try again` re-mounts the grid in place (no page reload) and refetches page one.
4. In Sentry, filter on `area:shop surface:product-grid` to find these errors.

## Configuration

None. No new runtime dependencies or environment variables. `@sentry/react` is a devDependency for the browser tests only.

## Testing

- `yarn turbo run test --filter=./apps/website` runs `ShopGridBoundary.browser.test.tsx`:
  - page placement: the fallback renders inside the Products region, the sell link survives outside it
  - reset: `Try again` re-renders the grid once the child stops throwing
  - real query: a 500 then a 200 from `fetch`, with `retry: false`, recovers to six product cards after `Try again`, with two fetches
- Negative checks: removing `<ShopGridBoundary>` from `page.tsx` fails the first two tests; removing `onReset={reset}` fails the third.
- The Playwright test in `e2e/shop.integration.spec.ts` is a scope guard for next-page failures (it would pass without this feature). The first-page fallback cannot be induced there, because page one is baked into the prerendered shell.
- Manual check: block `/api/shop/products` in DevTools and press "Load more". The next-page retry line should appear, never the grid fallback.

## Notes

- There is deliberately no `shop/error.tsx`, and `ProductList.tsx` is unchanged.
- `WhatsAppLink` keeps its shared bold link style on the grey shop ground. If it reads poorly there, change it via a prop on the shared component rather than forking it.
- Known pre-existing risk (out of scope): `getFirstPageState()` is `"use cache"` with `cacheLife("days")` and the prefetch swallows errors, so a transient server failure can cache an empty dehydrated state for up to a day, and every visitor then fetches page one from the browser. Fixing it means throwing from `getFirstPageState` on a failed query, which changes #163's cache behaviour and belongs in its own issue.
