# Restore BookingEngineSkeleton as the Suspense Fallback

**ADW ID:** 94ccaa09
**Date:** 2026-09-16
**Specification:** specs/issue-40-adw-94ccaa09-sdlc_planner-restore-booking-skeleton.md

## Overview

`BookingEngineSkeleton` was deleted in #39 when the booking engine moved from a
client-side React Query hook to a cached async Server Component, and its only
caller (the query's `isLoading` branch) went away with it. This chore re-adds
the component, updated to match `BookingClient`'s current DOM shape, and wires
it back in as the `<Suspense fallback>` for `BookingEngine` in the booking type
page, so a cache miss or Partial Prerendering stream shows a loading
placeholder instead of a blank gap.

## What Was Built

- A re-created `BookingEngineSkeleton` Server Component, rebuilt against
  `BookingClient`'s current markup rather than the pre-#39 shape.
- The skeleton wired into `page.tsx`'s existing `Suspense` boundary around
  `<BookingEngine>`, replacing `fallback={null}`.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx`
  (new): static, prop-less Server Component rendering the collapsed-state
  placeholder markup.
- `apps/website/src/app/(main)/booking/[type]/page.tsx`: imports
  `BookingEngineSkeleton` and changes `<Suspense fallback={null}>` to
  `<Suspense fallback={<BookingEngineSkeleton />}>` around `<BookingEngine>`.
- `.prettierignore`: unrelated tooling tweak bundled into this branch, adds
  `apps/website/test-results` to the ignore list.

### Key Changes

- The skeleton's DOM was updated to match what `BookingClient` produces today,
  not the pre-#39 shape: `<BookingPricing />` now renders as a **sibling** of
  `.booking-engine-collapsed` (inside `.booking-engine`), not nested inside
  `.booking-collapsed-main`.
- `.booking-dates-display` now has **three** placeholder cells (check-in,
  check-out, book) with `animate-pulse`, matching `BookingClient`'s three
  controls — the original skeleton only had two.
- Placeholder cells are non-interactive `div`/`span` elements styled with
  muted `border-gray-300`/`text-gray-400`, intentionally not reusing the real
  `.booking-date-button`/`.booking-book-button` classes since those imply
  interactivity the skeleton doesn't have.
- The skeleton imports and renders the real `BookingPricing` component
  directly rather than re-implementing a placeholder for it.
- `BookingEngine` itself is untouched: it has no loading state of its own by
  design, and the fallback lives one level up at the `page.tsx` call site.

## How to Use

No consumer-facing action needed — this only changes what renders while
`BookingEngine` is suspended:

1. Navigate to a booking type page (`/booking/[type]`).
2. On a cache miss for `getAvailability` (or while streaming under Partial
   Prerendering), the booking widget area now shows the skeleton's pulsing
   placeholder instead of a blank gap, until `BookingEngine` resolves.

## Configuration

None. No new environment variables, flags, or props.

## Testing

No new automated test was added; per the spec, a static prop-less Server
Component with no branches or interactions has nothing a
`*.unit.test.ts`/`*.browser.test.tsx` would meaningfully cover, and the actual
risk (Suspense wiring, or `getAvailability` genuinely suspending) isn't
observable in isolation. Verify via the existing validation commands:

- `yarn prettier --check .`
- `yarn turbo run lint --filter=website`
- `yarn turbo run typecheck --filter=website`
- `yarn knip` (confirms the skeleton is wired in, not dead code)
- `yarn turbo run test --filter=website`
- `yarn turbo run build --filter=website`

## Notes

- The `.booking-engine-loading` CSS class in `globals.css` remains unused;
  this chore intentionally left it alone (out of scope — removing unrelated
  dead CSS wasn't part of this change).
- The `.prettierignore` change (excluding `apps/website/test-results`) is
  bundled into this branch but is a repo-root tooling tweak, not part of the
  skeleton feature itself.
