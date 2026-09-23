# Room-specific booking link preview

**ADW ID:** f72316fa
**Date:** 2026-09-23
**Specification:** `specs/issue-122-adw-f72316fa-sdlc_planner-booking-og-metadata.md`

## Overview

When GCA's `send_booking_link` sends a guest a `/booking/roomN?checkIn=…` link on
WhatsApp, the preview used to show the home page's card: the site-wide title,
`og:url` = `https://issebya.com`, and a WebP image with no declared size. Each
room page now has its own Open Graph card with the room's title, a short room
description, a canonical URL for that room, and a 1200×630 JPEG room photo that
WhatsApp can render. The card depends on the room only, not on the link's dates,
so the route stays prerendered.

## What Was Built

- `generateMetadata` on `/booking/[type]`, giving each room its own title,
  description, canonical URL, `openGraph` block and `twitter` block.
- Two static JPEG share images, `public/og/booking-room1.jpg` (≈85 KB) and
  `public/og/booking-room2.jpg` (≈60 KB), 1200×630. They were center-cropped
  once from each room's first gallery photo (`bed.webp`, `bed_bedroom2.webp`).
  No script, build step or dependency was added.
- A module-private `leadingSentences` helper that picks the leading whole
  sentences of the room's first description paragraph that fit in 160
  characters.
- A gated unit test and a Playwright spec that fetches the page as WhatsApp.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/booking/[type]/page.tsx`: adds `generateMetadata`
  and `leadingSentences`. `ROOM_CONTENT`, the default export and
  `generateStaticParams` are unchanged.
- `apps/website/public/og/booking-room1.jpg`, `booking-room2.jpg`: new share
  images.
- `apps/website/src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts`:
  imports `generateMetadata` from `../page`, so removing the export breaks the
  suite.
- `apps/website/e2e/booking-og-metadata.integration.spec.ts`: requests each room
  with a WhatsApp user agent, reads the `og:*` tags from `<head>` only, and
  fetches the JPEG itself.

### Key Changes

- **Params only.** `generateMetadata` awaits `props.params` and nothing else. It
  never reads `searchParams`, `headers()` or `cookies()`. Under
  `cacheComponents: true`, reading any of them would make the route dynamic.
  This is also why the card has no dates or guest name.
- **Shallow merge.** Next.js merges segment metadata shallowly, so the page's
  `openGraph` and `twitter` objects replace the root layout's objects entirely.
  Each one sets its own `title`, `description` and image, because none of the
  layout's fields carry over.
- **Image shape.** The image is `{ url: "/og/booking-<type>.jpg", width: 1200,
height: 630, type: "image/jpeg", alt }`. The relative URL resolves against the
  root layout's `metadataBase` (`SITE_URL`). WhatsApp is reported to skip WebP
  and to use the declared dimensions to avoid fetching the image a second time.
- **Unknown type.** An unknown `type` falls back to room1's card rather than
  throwing, because the page itself redirects unknown types to `/booking/room1`.
- **WhatsApp gets metadata in `<head>`.** WhatsApp's user agent is in Next's
  `HTML_LIMITED_BOT_UA_RE`, so Next renders metadata into `<head>` (blocking)
  instead of streaming it. No `htmlLimitedBots` config was needed.

Card values per room: title `Book Private room N - issebya.homes`, `og:url` and
`<link rel="canonical">` `https://issebya.com/booking/roomN`, `og:type`
`website`, `twitter:card` `summary_large_image`.

## How to Use

Nothing to switch on. Any `/booking/room1` or `/booking/room2` URL, including
GCA links with a query string, produces the room's card.

To check a deployment:

```sh
curl -sL "https://<host>/booking/room2?checkIn=2026-10-06&checkOut=2026-10-08&source=gca" \
  -A "WhatsApp/2.23.20.0 A" | grep -oE '<meta [^>]*og:[^>]*>'
curl -sI "https://<host>/og/booking-room2.jpg"   # image/jpeg, < 300000 bytes
```

## Configuration

None. There are no environment variables. The absolute URLs come from
`SITE_URL` in `src/lib/site.ts`, through `metadataBase` in the root layout.

## Testing

- Unit (gated in CI and on push):
  `yarn workspace website vitest run --project unit 'src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts'`.
  It covers URL, canonical, the JPEG image fields, title, description length
  (160 characters or fewer), the twitter card, the unknown-type fallback, and a
  negative check that no field falls back to the root card (`SITE_URL` or a
  `.webp` image).
- Playwright (ADW test phase only, not CI):
  `yarn workspace website test:integration` runs
  `e2e/booking-og-metadata.integration.spec.ts`.
- Build: `/booking/room1` and `/booking/room2` must still show as prerendered in
  the `yarn turbo run build --filter=./apps/website` route table, not `ƒ`.

## Notes

- On a Vercel preview, `og:image` points at production because `metadataBase`
  is hardcoded to `SITE_URL`. The image returns 404 there until this change
  merges. To check the image on a preview, request its path on the preview host.
- WhatsApp caches previews per URL. GCA links carry unique query strings, so new
  links get the new card, but links sent before this change may keep the old
  one.
- To add a room: add it to `generateStaticParams`/`ROOM_CONTENT` and commit a
  matching `public/og/booking-<type>.jpg`. The image must be 1200×630, JPEG and
  under 300 KB.
- Next's `opengraph-image.jpg` file convention was not used. A static file in
  `booking/[type]/` would give every room the same image, and a per-param
  `opengraph-image.tsx` renders a PNG at build or request time.
