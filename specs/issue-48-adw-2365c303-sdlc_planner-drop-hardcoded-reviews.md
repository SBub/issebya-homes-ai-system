# Chore: Drop hardcoded Airbnb reviews from the website

## Metadata

issue_number: `48`
adw_id: `2365c303`
issue_json: `{"number":48,"title":"Drop hardcoded Airbnb reviews from the website; link out to the public listing reviews instead","body":"Guest reviews on the booking pages are hardcoded in `apps/website`and shown in a carousel. They go stale on every new Airbnb review, and copy-pasted testimonials on our own domain are weaker social proof than the same reviews on Airbnb.\n\nRemove the hardcoded reviews and the carousel. Replace them with a link per room, e.g. \"Read public reviews on Airbnb\".\n\nListing URLs:\n\n- Room 1:`https://www.airbnb.com/rooms/1424633715489915166`\n- Room 2: `https://www.airbnb.com/rooms/1507883205063503481`\n"}`

## Chore Description

The booking pages in `apps/website` currently render a hardcoded, hand-copied
list of Airbnb reviews per room (`src/data/airbnb-reviews.ts`) through a
client-side carousel component (`AirbnbReviewSlider`). This content goes
stale every time a new Airbnb review comes in, and copy-pasted testimonials
on our own domain carry weaker social proof than the same reviews on Airbnb
itself.

Remove the hardcoded review data and the carousel component entirely, along
with its test coverage. Replace the review block on each room's booking page
with a single outbound link per room to that room's public Airbnb listing
reviews, with copy along the lines of "Read public reviews on Airbnb":

- Room 1: `https://www.airbnb.com/rooms/1424633715489915166`
- Room 2: `https://www.airbnb.com/rooms/1507883205063503481`

## Relevant Files

Use these files to resolve the chore:

- `apps/website/src/app/(main)/booking/[type]/page.tsx` - Renders
  `<AirbnbReviewSlider>` with `room1Reviews`/`room2Reviews` (page.tsx:121-124)
  inside the per-room content column. This is where the review block is
  swapped for the outbound Airbnb link. It already has an established inline
  external-link pattern to follow (the Google Maps link, page.tsx:104-113:
  plain `<a target="_blank" rel="noopener noreferrer">` styled with
  `underline hover:text-gray-600`) and an existing
  `ROOM_CONTENT: Record<string, {...}>` map (page.tsx:28-45) keyed by room
  type, which is the natural place to add each room's Airbnb listing URL.
- `apps/website/src/app/ui/AirbnbReviewSlider.tsx` - The carousel component
  being removed. Only ever imported by `page.tsx`.
- `apps/website/src/app/ui/AirbnbReviewSlider.browser.test.tsx` - Vitest
  browser-mode tests for the carousel; removed alongside the component since
  there is nothing left to test.
- `apps/website/src/data/airbnb-reviews.ts` - Hardcoded `room1Reviews` /
  `room2Reviews` arrays; removed entirely. Confirmed via grep that
  `page.tsx` and the component's own test file are the only consumers of
  this module and of `AirbnbReviewSlider`.
- `apps/website/AGENTS.md` - Workspace conventions: TypeScript only,
  functional components, server components by default (`'use client'` only
  when browser state is needed), Next.js `<Image>` for images, Zod at API
  boundaries. The replacement link is static markup with no client state, so
  it belongs directly in `page.tsx` (a server component) rather than in a
  new client component.
- `knip.json` - Repo-wide knip config; `apps/website` project globs already
  cover `src/**/*.ts(x)`, so deleting the three files above is enough for
  knip to stop reporting them. No config change needed since none of the
  three files appear in `ignoreFiles`/`ignoreIssues`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add each room's Airbnb listing URL to the page's room-content map

- In `apps/website/src/app/(main)/booking/[type]/page.tsx`, extend the
  `ROOM_CONTENT` record (currently `Record<string, { title: string;
description: string[] }>`, page.tsx:28) with an `airbnbUrl: string` field
  for each room:
  - `room1`: `https://www.airbnb.com/rooms/1424633715489915166`
  - `room2`: `https://www.airbnb.com/rooms/1507883205063503481`
- Update the type annotation on `ROOM_CONTENT` to include `airbnbUrl:
string`.

### 2. Replace the review carousel with an outbound Airbnb link

- Still in `page.tsx`, destructure `airbnbUrl` alongside `title` and
  `description` from `ROOM_CONTENT[type]` (page.tsx:61).
- Remove the `import { AirbnbReviewSlider } from "@/app/ui/AirbnbReviewSlider";`
  and `import { room1Reviews, room2Reviews } from "@/data/airbnb-reviews";`
  statements (page.tsx:4, page.tsx:9).
- Replace the `<AirbnbReviewSlider key={roomType} reviews={...} />` block
  (page.tsx:121-124) with a single link, following the same inline-anchor
  pattern already used for the Google Maps link (page.tsx:104-113):
  ```tsx
  <p className="text-sm leading-relaxed">
    <a
      href={airbnbUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-gray-600"
    >
      Read public reviews on Airbnb
    </a>
  </p>
  ```
  Keep its position in the layout where the review block used to sit
  (between the room description paragraphs and the closing `Callout`).

### 3. Delete the carousel component, its test, and the hardcoded data

- Delete `apps/website/src/app/ui/AirbnbReviewSlider.tsx`.
- Delete `apps/website/src/app/ui/AirbnbReviewSlider.browser.test.tsx`.
- Delete `apps/website/src/data/airbnb-reviews.ts`.
- Confirm nothing else imports `AirbnbReviewSlider`, `room1Reviews`, or
  `room2Reviews`:
  `grep -rn "AirbnbReviewSlider\|airbnb-reviews\|room1Reviews\|room2Reviews" apps/website/src apps/website/e2e`
  should return no results after the edits in this step.

### 4. Validate

- Run every command in `Validation Commands` below and fix anything that
  fails before considering the chore done.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=website` - Lint passes for the website workspace
- `yarn turbo run typecheck --filter=website` - Types are sound for the website workspace (catches any leftover `ROOM_CONTENT` typing mismatch)
- `yarn knip` - No unused files, exports or dependencies remain (confirms the deleted component/data files leave no dangling references)
- `yarn turbo run test --filter=website` - Unit and browser tests pass, proving the removed carousel's tests are gone and nothing else broke
- `yarn turbo run build --filter=website` - Production build succeeds

## Notes

- The Google Maps link a few lines above (page.tsx:104-113) is the direct
  style precedent for the new Airbnb link: plain anchor, `target="_blank"`,
  `rel="noopener noreferrer"`, `underline hover:text-gray-600`, no click
  tracking. `WhatsAppLink` (`apps/website/src/app/ui/WhatsAppLink.tsx`) does
  capture a PostHog click event, but it's a shared client component reused
  across pages; the one-off Airbnb link doesn't need that machinery and
  matching the Maps-link precedent keeps this change minimal.
- No e2e test, other page, or other workspace references the review data or
  component, so this is a self-contained change within `apps/website`.
