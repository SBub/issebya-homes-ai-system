# Chore: Drop hardcoded Airbnb reviews from the website

**ADW ID:** 2365c303
**Date:** 2026-09-16
**Specification:** specs/issue-48-adw-2365c303-sdlc_planner-drop-hardcoded-reviews.md

## Overview

The booking pages used to render a hand-copied list of Airbnb reviews per
room through a client-side carousel (`AirbnbReviewSlider`). That content went
stale every time a new Airbnb review came in, and copy-pasted testimonials on
our own domain were weaker social proof than the same reviews on Airbnb
itself. The carousel, its data, and its tests were removed and replaced with
a single outbound link per room to that room's public Airbnb listing.

## What Was Built

- A per-room `airbnbUrl` added to the existing `ROOM_CONTENT` map on the
  booking type page
- A plain outbound link ("Read public reviews on Airbnb") rendered in place
  of the review carousel, styled to match the existing Google Maps link
- Removal of the `AirbnbReviewSlider` component, its browser test, and the
  hardcoded `airbnb-reviews.ts` data module

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/booking/[type]/page.tsx`: added `airbnbUrl`
  to `ROOM_CONTENT` and its type, dropped the `AirbnbReviewSlider` and
  `airbnb-reviews` imports, replaced the `<AirbnbReviewSlider>` block with a
  plain `<a>` link
- `apps/website/src/app/ui/AirbnbReviewSlider.tsx`: deleted
- `apps/website/src/app/ui/AirbnbReviewSlider.browser.test.tsx`: deleted
- `apps/website/src/data/airbnb-reviews.ts`: deleted

### Key Changes

- `ROOM_CONTENT: Record<string, { title: string; description: string[] }>`
  gained an `airbnbUrl: string` field, one value per room type
  (`room1`/`room2`)
- The review block now follows the same inline-anchor precedent already used
  for the Google Maps link on the same page: plain `<a target="_blank"
  rel="noopener noreferrer">` styled with `underline hover:text-gray-600`,
  no client component and no click tracking
- No new client-side state was introduced; the page remains a server
  component

## How to Use

1. Visit a room's booking page (`/booking/room1` or `/booking/room2`)
2. Below the room description, click "Read public reviews on Airbnb" to open
   that room's Airbnb listing in a new tab

## Configuration

None. The two Airbnb listing URLs are inlined as static strings in
`ROOM_CONTENT`:

- `room1`: `https://www.airbnb.com/rooms/1424633715489915166`
- `room2`: `https://www.airbnb.com/rooms/1507883205063503481`

## Testing

- `yarn turbo run test --filter=website` confirms the removed carousel's
  tests are gone and nothing else broke
- `yarn knip` confirms no dangling references to the deleted component or
  data module remain
- `yarn turbo run typecheck --filter=website` and `yarn turbo run lint
  --filter=website` catch any leftover `ROOM_CONTENT` typing mismatch
- `yarn turbo run build --filter=website` confirms the production build
  still succeeds

## Notes

- This is a self-contained change within `apps/website`; no e2e test, other
  page, or other workspace referenced the review data or component
- Unlike `WhatsAppLink`, which is a shared client component that captures a
  PostHog click event, this one-off link doesn't need that machinery
