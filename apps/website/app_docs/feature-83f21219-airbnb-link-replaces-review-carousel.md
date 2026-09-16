# Drop Hardcoded Airbnb Reviews for a Link to the Listing

**ADW ID:** 83f21219
**Date:** 2026-09-16
**Specification:** specs/issue-58-adw-83f21219-sdlc_planner-drop-hardcoded-reviews.md

## Overview

The booking pages (`/booking/room1`, `/booking/room2`) used to render a swipeable carousel of hardcoded Airbnb guest reviews, sourced from a static data file. That copy went stale every time a new review landed on Airbnb and was weaker social proof off-platform than the same reviews on Airbnb itself. The carousel and its data are removed and replaced with a single outbound link per room pointing at that room's real Airbnb listing.

## What Was Built

- A new `AirbnbLink` client component rendering a "Read public reviews on Airbnb" link that opens the room's Airbnb listing in a new tab and fires a PostHog `airbnb_link_clicked` event on click.
- Per-room Airbnb listing URLs added to the booking page's existing `ROOM_CONTENT` map (`airbnbUrl` field), one per room.
- Removal of the `AirbnbReviewSlider` carousel component, its component test, and the hardcoded `airbnb-reviews.ts` review data.

## Technical Implementation

### Files Modified

- `apps/website/src/app/ui/AirbnbLink.tsx`: new shared component (follows the `WhatsAppLink.tsx` pattern), takes an `href` prop and renders the outbound link with a PostHog capture on click.
- `apps/website/src/app/(main)/booking/[type]/page.tsx`: `ROOM_CONTENT` gained an `airbnbUrl` field per room; swapped the `AirbnbReviewSlider` import/render for `AirbnbLink`, and dropped the `room1Reviews`/`room2Reviews` import.
- `apps/website/src/app/ui/AirbnbReviewSlider.tsx`: deleted.
- `apps/website/src/app/ui/AirbnbReviewSlider.browser.test.tsx`: deleted.
- `apps/website/src/data/airbnb-reviews.ts`: deleted (hardcoded review data).

### Key Changes

- Room-specific data (title, description, and now `airbnbUrl`) continues to live in one place, `ROOM_CONTENT`, rather than introducing a second per-room data source.
- `AirbnbLink` is a `"use client"` component only because it needs the `onClick` PostHog capture, mirroring `WhatsAppLink.tsx`.
- No new component test was added for `AirbnbLink`, matching the precedent set by `WhatsAppLink.tsx` (plain markup, no state or interaction beyond the click-through).

## How to Use

1. Visit `/booking/room1` or `/booking/room2`.
2. Where the review carousel used to render, a "Read public reviews on Airbnb" link now appears.
3. Clicking it opens the room's Airbnb listing in a new tab and emits an `airbnb_link_clicked` PostHog event.

## Configuration

None. The two listing URLs are hardcoded in `ROOM_CONTENT` per the issue body; there is no environment variable or CMS field for them.

## Testing

- `yarn prettier --check .`, `yarn turbo run lint --filter=apps/website`, `yarn turbo run typecheck --filter=apps/website`, `yarn knip`, `yarn turbo run test --filter=apps/website`, and `yarn turbo run build --filter=apps/website` all validate this change (formatting, lint, types, no dangling references to the deleted files, unit/component tests, and production build).
- Manual check: load both booking pages in the dev server, confirm the link renders in place of the old carousel, opens the correct listing per room in a new tab, and produces no console errors.

## Notes

- Presentational-only change, scoped to `apps/website/src/app/ui/` and the one booking page. No database, API route, or Server Action changes.
