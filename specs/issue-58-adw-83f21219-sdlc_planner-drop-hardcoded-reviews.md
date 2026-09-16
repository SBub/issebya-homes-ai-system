# Chore: Drop hardcoded Airbnb reviews (full SDLC via webhook)

## Metadata

issue_number: `58`
adw_id: `83f21219`
issue_json: `{"number":58,"title":"Drop hardcoded Airbnb reviews (full SDLC via webhook)","body":"Guest reviews on the booking pages are hardcoded in \`apps/website\` and shown in a carousel. They go stale on every new Airbnb review, and copy-pasted testimonials on our own domain are weaker social proof than the same reviews on Airbnb.\n\nRemove the hardcoded reviews and the carousel. Replace them with a link per room, e.g. \"Read public reviews on Airbnb\".\n\nListing URLs:\n\n- Room 1: \`https://www.airbnb.com/rooms/1424633715489915166\`\n- Room 2: \`https://www.airbnb.com/rooms/1507883205063503481\`\n\n/adw_sdlc_iso"}`

## Chore Description

The booking pages in `apps/website` (`/booking/room1` and `/booking/room2`) currently render a
hardcoded list of Airbnb guest reviews in a swipeable carousel (`AirbnbReviewSlider`), sourced
from `src/data/airbnb-reviews.ts`. These copy-pasted testimonials go stale every time a new
review lands on Airbnb, and they're weaker social proof off-platform than the same reviews would
be on Airbnb itself.

Remove the hardcoded review data and the carousel component entirely. In their place, add a
simple outbound link per room pointing at that room's real Airbnb listing, e.g. "Read public
reviews on Airbnb". Each room has its own Airbnb listing URL:

- Room 1: `https://www.airbnb.com/rooms/1424633715489915166`
- Room 2: `https://www.airbnb.com/rooms/1507883205063503481`

## Relevant Files

Use these files to resolve the chore:

- `apps/website/src/app/(main)/booking/[type]/page.tsx` - renders `<AirbnbReviewSlider>` with
  `room1Reviews`/`room2Reviews` (lines ~4, 9, 121-124). `ROOM_CONTENT` already keys per-room
  static copy (`title`, `description`) by `type`; the room's Airbnb URL belongs alongside it in
  the same map. This is the only page that renders the slider or the new link.
- `apps/website/src/app/ui/AirbnbReviewSlider.tsx` - the carousel component being removed. Not
  imported anywhere else in the repo.
- `apps/website/src/app/ui/AirbnbReviewSlider.browser.test.tsx` - component test for the slider;
  removed alongside the component it tests.
- `apps/website/src/data/airbnb-reviews.ts` - hardcoded `room1Reviews`/`room2Reviews` data being
  removed. Not imported anywhere else in the repo.
- `apps/website/src/app/ui/WhatsAppLink.tsx` - the pattern to follow for the new link component:
  a small shared `"use client"` component in `src/app/ui/` rendering an `<a target="_blank"
rel="noopener noreferrer">` with a `posthog.capture(...)` call on click. No test file exists
  for it, matching this chore's link component (plain markup, no state/interaction beyond the
  click-through).
- `apps/website/AGENTS.md` - workspace conventions (calendar-day string rules, availability
  invariants); none of them are touched by this chore, but read before editing this workspace.
- `apps/website/app_docs/component-patterns-guide.md` - confirms where a new shared,
  cross-feature component belongs (`src/app/ui/`) and the "extend, don't duplicate" and
  `@/`-alias import conventions to follow.
- `apps/website/app_docs/import-patterns-guide.md` - use destructured imports for the new
  component and its `posthog-js` import (`import posthog from "posthog-js"`, matching
  `WhatsAppLink.tsx`'s existing default-import style, which is the library's only public export
  shape).
- `apps/website/app_docs/branding-guidelines.md` - confirms `issebya.homes` brand-name casing in
  case any nearby copy is touched (no brand-name copy is added by this chore, but the file's
  scope was checked).

### New Files

- `apps/website/src/app/ui/AirbnbLink.tsx` - new shared component rendering the per-room outbound
  link to the room's Airbnb listing, replacing `AirbnbReviewSlider`.

## Step by Step Tasks

### 1. Add the `AirbnbLink` component

- Create `apps/website/src/app/ui/AirbnbLink.tsx` following the `WhatsAppLink.tsx` pattern:
  - `"use client"` directive (needed for the `onClick` posthog capture).
  - Props: `href: string` (the room's Airbnb listing URL).
  - Renders `<a href={href} target="_blank" rel="noopener noreferrer" className="text-sm underline hover:text-gray-600">Read public reviews on Airbnb</a>` (match the surrounding booking-page text sizing, e.g. the `text-sm leading-relaxed` siblings it replaces — check the rendered page and adjust classes so it sits visually consistent with the location link and description paragraphs above it).
  - `onClick` handler calling `posthog.capture("airbnb_link_clicked")`, matching
    `WhatsAppLink.tsx`'s inline `posthog.capture("whatsapp_link_clicked")` call (destructured
    default import: `import posthog from "posthog-js"`).

### 2. Wire the per-room Airbnb URLs into the booking page

- In `apps/website/src/app/(main)/booking/[type]/page.tsx`:
  - Add `airbnbUrl` to the `ROOM_CONTENT` map's type (`Record<string, { title: string; description: string[]; airbnbUrl: string }>`) and values:
    - `room1.airbnbUrl = "https://www.airbnb.com/rooms/1424633715489915166"`
    - `room2.airbnbUrl = "https://www.airbnb.com/rooms/1507883205063503481"`
  - Destructure `airbnbUrl` alongside `title`/`description` from `ROOM_CONTENT[type]`.
  - Replace the `import { AirbnbReviewSlider } from "@/app/ui/AirbnbReviewSlider";` and
    `import { room1Reviews, room2Reviews } from "@/data/airbnb-reviews";` imports with
    `import { AirbnbLink } from "@/app/ui/AirbnbLink";`.
  - Replace the `<AirbnbReviewSlider key={roomType} reviews={...} />` block with
    `<AirbnbLink href={airbnbUrl} />`.

### 3. Remove the hardcoded review carousel and data

- Delete `apps/website/src/app/ui/AirbnbReviewSlider.tsx`.
- Delete `apps/website/src/app/ui/AirbnbReviewSlider.browser.test.tsx`.
- Delete `apps/website/src/data/airbnb-reviews.ts`.
- Confirm `apps/website/src/data/` has no remaining files; if it's now empty, leave the empty
  directory alone (git does not track empty directories, so nothing further to do).

### 4. Validate

- Run the `Validation Commands` below and fix anything they surface. Manually load
  `/booking/room1` and `/booking/room2` in the dev server and confirm the "Read public reviews on
  Airbnb" link renders where the carousel used to, opens the correct listing URL for each room in
  a new tab, and no console errors appear.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=apps/website` - Lint passes for the website workspace
- `yarn turbo run typecheck --filter=apps/website` - Types are sound for the website workspace
- `yarn knip` - No unused files, exports or dependencies were left behind (catches leftover references to the deleted slider/data files)
- `yarn turbo run test --filter=apps/website` - Unit/component tests pass, proving the removed `AirbnbReviewSlider.browser.test.tsx` isn't still referenced and nothing else broke
- `yarn turbo run build --filter=apps/website` - Production build succeeds

## Notes

- No database, API route, or Server Action changes are involved; this is a presentational-only
  change scoped entirely to `apps/website/src/app/ui/` and the one booking page.
- The two listing URLs are fixed per the issue body; there's no per-room config file elsewhere in
  the codebase to update (the only other room-keyed data structures are `room1Images`/
  `room2Images` in `src/utils/images.ts` and `ROOM_CONTENT` in the booking page itself — this plan
  extends `ROOM_CONTENT` rather than introducing a third parallel per-room data source).
- Do not touch `apps/website/src/app/(main)/booking/[type]/page-1.tsx` or `store-1.tsx` — they're
  intentionally ignored by knip (`knip.json`) and out of scope for this chore.
