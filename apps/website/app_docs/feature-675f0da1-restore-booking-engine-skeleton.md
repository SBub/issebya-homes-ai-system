# Restore BookingEngineSkeleton as the Suspense Fallback

**ADW ID:** 675f0da1
**Date:** 2026-09-17
**Specification:** specs/issue-40-adw-675f0da1-sdlc_planner-restore-booking-engine-skeleton.md

## Overview

The `<Suspense>` boundary wrapping the async `BookingEngine` Server Component on the booking type page previously used `fallback={null}`, so a cache miss or PPR streaming gap rendered blank space where the booking widget belongs. This restores a `BookingEngineSkeleton` component (originally removed when the booking engine moved to Server Components) as that fallback, updated to match the current three-cell collapsed layout.

## What Was Built

- A `BookingEngineSkeleton` Server Component that mirrors `BookingClient`'s collapsed-state markup: a pulsing three-cell row (check-in, check-out, book) plus the real, non-skeletonized `BookingPricing` underneath.
- Wiring of that skeleton into `page.tsx`'s `<Suspense fallback={...}>` around `<BookingEngine roomType={roomType} />`, replacing `fallback={null}`.
- A browser component test asserting the skeleton's structure and that the real pricing content renders alongside it.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/booking/[type]/page.tsx`: imports `BookingEngineSkeleton` and changes `<Suspense fallback={null}>` to `<Suspense fallback={<BookingEngineSkeleton />}>`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` (new): the restored skeleton component.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.browser.test.tsx` (new): smoke test for the skeleton's markup.

### Key Changes

- The skeleton is a plain Server Component (no `"use client"`) since it has no state or interactivity, consistent with `apps/website/AGENTS.md`'s server-by-default rule and with being usable directly as a `fallback` prop from another Server Component.
- It reuses existing CSS classes from `globals.css` (`booking-engine`, `booking-engine-collapsed`, `booking-collapsed-main`, `booking-dates-display`, `booking-date-button`, `booking-date-value`, `booking-date-separator`, `booking-book-button`) plus Tailwind's `animate-pulse`, rather than inventing new ones.
- The placeholder row now has three cells (check-in, check-out, book) instead of the original two, because `BookingClient`'s live collapsed layout gained a `book` button since the skeleton was last deleted; matching the current shape avoids layout shift when the real content swaps in.
- Placeholders use non-interactive `<div>`/`<span>` elements with muted colors (`text-gray-400`, `border-gray-300`, `bg-gray-300`), not `<button>`, since nothing is clickable while `BookingEngine` is still resolving.
- The real `BookingPricing` component renders underneath, unskeletonized, because it's static copy sourced from the `pricing` package rather than the awaited `getAvailability` call.

## How to Use

No consumer-facing API: `BookingEngineSkeleton` is only used as the `fallback` of the `<Suspense>` boundary in `apps/website/src/app/(main)/booking/[type]/page.tsx`. It renders automatically whenever `BookingEngine`'s cached `getAvailability` call hasn't resolved yet (cold cache, or a streaming gap under Partial Prerendering).

## Configuration

None.

## Testing

- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.browser.test.tsx` renders `<BookingEngineSkeleton />` in isolation (Vitest browser mode) and asserts the pulsing dates row exists, contains three placeholder cells (check-in, check-out, book), and that real `BookingPricing` text ("per night") renders underneath.
- Run `yarn turbo run test --filter=website` to execute it alongside the rest of the workspace's tests.
- The `Suspense` wiring itself is not separately tested: forcing the fallback to trigger deterministically would require an artificial delay that tests the delay rather than the wiring, and the `fallback={...}` prop is a one-line, statically-typed JSX change already guarded by `tsc`.

## Notes

- This mirrors the markup previously removed in `67c3ca7` (`refactor(website): convert booking engine and checkout to Server Components/Actions, drop React Query`), updated for `BookingClient`'s current three-cell layout instead of the old two-cell one.
