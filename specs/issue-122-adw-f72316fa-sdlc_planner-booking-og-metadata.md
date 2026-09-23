# Feature: Room-specific, WhatsApp-renderable Open Graph card for `/booking/[type]`

## Metadata

issue_number: `122`
adw_id: `f72316fa`
issue_json: `{"number":122,"title":"website: booking-link preview shows the generic home card — make /booking/[type] OG metadata room-specific and WhatsApp-renderable", ...}`

## Feature Description

GCA's `send_booking_link` sends a guest a WhatsApp message containing
`https://issebya.com/booking/room1?checkIn=…&checkOut=…&phone=…&guestName=…&email=…&source=gca`.
WhatsApp renders a link preview for it, and that preview is currently the home page's card: the
site-wide title and description, `og:url` = `https://issebya.com`, and `og:image` =
`living_room.webp` (1920×1280 WebP, ~157 KB). `/booking/[type]/page.tsx` exports no metadata, so
it inherits everything from the root `layout.tsx`.

This feature gives each room page its own card: the room's title, a short room description, a
canonical URL pointing at that room's page, and a room photo served as a 1200×630 JPEG under
300 KB, with explicit width/height/type so WhatsApp can render it without a second fetch. The card
is per room, not per dates, so the route stays prerendered.

## User Story

As a guest who has just received a booking link from the issebya.homes WhatsApp assistant
I want the link preview to show the room I am about to book, with that room's photo
So that I can recognise the link as the room we discussed and trust it before tapping through

## Problem Statement

1. The card is not room-specific: `og:title`, `og:description`, `og:url` and `og:image` are the
   home page's, because the root layout's `metadata` is the only metadata on the route.
2. The card's image is a WebP. WhatsApp's link-preview fetcher is reported (not verifiable from the
   repo) to render only JPEG/PNG `og:image`s under ~300 KB, and to use
   `og:image:width`/`og:image:height` to avoid a second fetch. The current image is WebP and has no
   declared dimensions.

## Solution Statement

- Commit two static JPEG share images, `apps/website/public/og/booking-room1.jpg` and
  `apps/website/public/og/booking-room2.jpg`, 1200×630, each < 300 KB, center-cropped from each
  room's first gallery photo (`bed.webp`, `bed_bedroom2.webp`). Generated once with `sips`
  (macOS, already on the machine) — no script committed, no build step, no dependency.
- Add `export async function generateMetadata(props)` to `booking/[type]/page.tsx`, following the
  blog's `blog/[slug]/page.tsx` pattern. It awaits `props.params` only (never `searchParams`,
  `headers()`, `cookies()`), so it is static and the two `generateStaticParams` rooms keep
  prerendering under `cacheComponents: true`.
- Because Next.js merges segment metadata **shallowly** (docs: `generate-metadata.md` → "Merging"),
  the page's `openGraph` and `twitter` objects replace the root layout's wholesale. So they must
  each carry their own `title`, `description`, `url`/`images`; nothing is inherited field-by-field.
- Unknown `type` does not throw: it falls back to the room1 card (the page itself redirects unknown
  types to `/booking/room1`, so room1 is the honest canonical).
- The root layout metadata and the blog's metadata are not touched.
- WhatsApp's UA (`WhatsApp`) is in Next's `HTML_LIMITED_BOT_UA_RE`
  (`next/dist/shared/lib/router/utils/html-bots.js`), so Next renders metadata blocking into
  `<head>` for it rather than streaming; no `htmlLimitedBots` config change is needed.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` — repo conventions (yarn only, conventional commits, no `Co-Authored-By`, lefthook).
- `apps/website/AGENTS.md` — read `node_modules/next/dist/docs/` before any Next.js work; test
  layers: `*.unit.test.ts` gates in CI and on push, `e2e/` does not gate in CI but runs in the ADW
  test phase.
- `apps/website/ENGINEERING.md` — why pages render the way they do; test layers.
- `apps/website/app_docs/nextjs-patterns-guide.md` — changing a route (adds `generateMetadata`).
- `apps/website/app_docs/dynamic-url-construction.md` — base-URL rule; `src/lib/site.ts` explains
  why `SITE_URL` is the correct shape for metadata (it cannot read the request without going
  dynamic).
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` — when a route stops
  prerendering; `SITE_URL`.
- `apps/website/app_docs/branding-guidelines.md` — guest-facing copy (the card title/description).
- `apps/website/app_docs/testing/unit_test_spec_format.md` — unit test format.
- `apps/website/app_docs/testing/e2e_example.md` — Playwright spec conventions.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` —
  `generateMetadata` API, shallow merging, streaming metadata / HTML-limited bots.
- `node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md` — OG images.
- `apps/website/src/app/(main)/booking/[type]/page.tsx` — the route; holds `ROOM_CONTENT`,
  `generateStaticParams`, and gains `generateMetadata`.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx` — the pattern to follow (per-post
  `generateMetadata`, canonical URL, unknown-slug comment).
- `apps/website/src/app/layout.tsx` — root metadata with `metadataBase: new URL(SITE_URL)`; must
  remain unchanged. Its values are what the page currently inherits.
- `apps/website/src/lib/site.ts` — `SITE_URL = "https://issebya.com"`.
- `apps/website/src/lib/shared/types/booking.ts` — `BookingType`, `isValidBookingType`.
- `apps/website/src/utils/images.ts` — `room1Images[0]` = `/bed.webp`, `room2Images[0]` =
  `/bed_bedroom2.webp` (sources for the JPEGs and the `alt` text).
- `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts` — existing
  `vi.mock` patterns (e.g. `@sentry/nextjs`) for a node-pool unit test next to this route.
- `apps/website/e2e/booking-flow.integration.spec.ts`,
  `apps/website/e2e/blog-booking-flow.integration.spec.ts` — Playwright spec conventions;
  `baseURL` is configured by `playwright.config.ts`.
- `apps/website/next.config.ts` — confirms `cacheComponents: true` (read only, not changed).
- `apps/website/vitest.config.ts` — `unit` project includes `src/**/*.unit.test.ts`, node env.
- `knip.json` — `apps/website` entries include `src/**/*.unit.test.ts` and `e2e/**/*.ts`.
- `apps/guest-communication-agent/src/agent/tools/booking.ts` — `computeSendBookingLink` /
  `BOOKING_LINK_URL_PATTERN`; read only, to confirm the link format is not changed.

### New Files

- `apps/website/public/og/booking-room1.jpg` — 1200×630 JPEG share image for room 1, < 300 KB.
- `apps/website/public/og/booking-room2.jpg` — 1200×630 JPEG share image for room 2, < 300 KB.
- `apps/website/src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts` — unit tests for
  `generateMetadata` imported from `../page`.
- `apps/website/e2e/booking-og-metadata.integration.spec.ts` — Playwright spec fetching the real
  rendered HTML with a WhatsApp user agent and the share image itself.

## Implementation Plan

### Phase 1: Foundation

Read the Next.js `generateMetadata` and metadata/OG-image docs in `node_modules/next/dist/docs/`
(required by `apps/website/AGENTS.md`). Produce and commit the two JPEG share images and verify
their dimensions, format and size.

### Phase 2: Core Implementation

Add `generateMetadata` to `booking/[type]/page.tsx`: resolve `type` from `params` (falling back to
room1 for an unknown type), build title, a ≤160-char description from whole leading sentences of
`ROOM_CONTENT[type].description[0]`, canonical URL, `openGraph` and `twitter` blocks with the JPEG.

### Phase 3: Integration

Prove the wiring at two layers: a gated unit test that imports `generateMetadata` from the page
module itself (so removing the export fails it), and a Playwright spec that fetches the rendered
page as WhatsApp would and checks the `<meta>` tags and the image response. Confirm the build still
lists both rooms as prerendered.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs

- Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`
  (sections: `generateMetadata`, `openGraph`, `twitter`, `alternates`, "Merging", "Streaming
  metadata") and `node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md`.
- Re-read `blog/[slug]/page.tsx`'s `generateMetadata` as the model.

### 2. Generate the JPEG share images

- `mkdir -p apps/website/public/og`
- For each room (sources are 1920×1280 and 1920×1440; scale to width 1200, then center-crop the
  height to 630):
  ```sh
  cd apps/website/public
  sips -s format jpeg -s formatOptions 80 --resampleWidth 1200 bed.webp --out og/booking-room1.jpg
  sips --cropToHeightWidth 630 1200 og/booking-room1.jpg
  sips -s format jpeg -s formatOptions 80 --resampleWidth 1200 bed_bedroom2.webp --out og/booking-room2.jpg
  sips --cropToHeightWidth 630 1200 og/booking-room2.jpg
  ```
  (If `sips` cannot read WebP on the machine, a one-off
  `node -e` with the `sharp` that Next already installs — `sharp(src).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 80 })` — is acceptable. Do not commit a script, do not add a dependency.)
- Verify: `sips -g pixelWidth -g pixelHeight -g format og/*.jpg` shows 1200×630 `jpeg`, and
  `stat -f %z og/*.jpg` is < 300000 for both. If either is ≥ 300000, lower `formatOptions`.
- Open both files (Read tool) and confirm the crop still reads as the bed/room. If the center crop
  cuts the bed badly, use a different offset (`--cropOffset`) or the next gallery photo; note the
  choice in the PR.

### 3. Add `generateMetadata` to `booking/[type]/page.tsx`

- Add imports: `import type { Metadata } from "next";` and `import { SITE_URL } from "@/lib/site";`.
- Add a module-private helper that returns the leading whole sentences of a text that fit within
  160 characters (split on `/(?<=\.)\s+/`, accumulate while the joined length stays ≤ 160; if even
  the first sentence exceeds 160, cut at the last word boundary ≤ 159 and append `…`). Keep it
  un-exported (knip) and inline in the page file; it is only used here.
- Add the function, placed after `generateStaticParams`:
  ```ts
  export async function generateMetadata(props: {
    params: Promise<{ type: string }>;
  }): Promise<Metadata> {
    const { type: requested } = await props.params;
    // An unknown type is a redirect, not a build failure: the page itself
    // redirects to /booking/room1. Returning room1's card here keeps
    // generateMetadata from throwing first, and matches where the guest lands.
    const type = isValidBookingType(requested) ? requested : BookingType.room1;
    const { title } = ROOM_CONTENT[type];
    const description = leadingSentences(ROOM_CONTENT[type].description[0]);
    const url = `${SITE_URL}/booking/${type}`;
    const image = {
      url: `/og/booking-${type}.jpg`,
      width: 1200,
      height: 630,
      type: "image/jpeg",
      alt: `${title} at issebya.homes`,
    };
    return {
      title: `Book ${title} - issebya.homes`,
      description,
      alternates: { canonical: url },
      openGraph: {
        title: `Book ${title} - issebya.homes`,
        description,
        url,
        type: "website",
        images: [image],
      },
      twitter: {
        card: "summary_large_image",
        title: `Book ${title} - issebya.homes`,
        description,
        images: [image.url],
      },
    };
  }
  ```
  - Use the same props shape as the existing default export (`{ params: Promise<{ type: string }> }`)
    rather than `PageProps<"/booking/[type]">`, so the unit test can call it with only `params`
    without a type cast (`PageProps` also requires `searchParams`).
  - Image URL is relative; `metadataBase` in the root layout resolves it to
    `https://issebya.com/og/booking-<type>.jpg`. The `.webp` → `issebya.com` → `www` CDN redirect
    that already works for `living_room.webp` applies equally.
  - Must not read `searchParams`, `headers()`, `cookies()`. Add a one-line comment saying so, like
    the blog page's.
  - Use a hyphen, not an em-dash, in the title (repo copy rule).
- Do not change `ROOM_CONTENT`, the default export, the link format, or `layout.tsx`.

### 4. Unit test: `__tests__/metadata.unit.test.ts`

- Import `generateMetadata` from `../page` (the page module itself, so the test fails if the export
  is removed). Mock the heavy imports the node pool cannot or should not load, following
  `actions.unit.test.ts`: `vi.mock("@sentry/nextjs", () => ({ ErrorBoundary: () => null }))`,
  `vi.mock("../ui/BookingEngine", () => ({ BookingEngine: () => null }))`,
  `vi.mock("../ui/BookingEngineSkeleton", …)`, `vi.mock("../ui/Gallery", () => ({ default: () => null }))`,
  and any `@/app/ui/*` client component that fails to import in node. Only mock what actually
  fails to import; confirm by running the test.
- Helper: `const meta = (type: string) => generateMetadata({ params: Promise.resolve({ type }) });`
- Cases (`describe.each` over room1/room2):
  - `openGraph.url === "https://issebya.com/booking/<type>"` and
    `alternates.canonical === openGraph.url`.
  - `openGraph.images[0]`: `url` ends in `.jpg` and contains `booking-<type>`, `width === 1200`,
    `height === 630`, `type === "image/jpeg"`, `alt` non-empty.
  - `title` contains `"Private room 1"` / `"Private room 2"`; `openGraph.title` equals `title`.
  - `description` length ≤ 160, non-empty, and the room's full description starts with it.
  - `twitter.card === "summary_large_image"` and `twitter.images` contains the same `.jpg` URL.
  - `openGraph` has its own `title` and `description` (guards the shallow-merge trap).
- Unknown type: `await expect(meta("room3")).resolves.toBeDefined()` and its `openGraph.url` is the
  room1 URL.
- Negative (fails if the route fell back to the root card): for both rooms, `openGraph.url` is not
  `SITE_URL` and no image URL ends in `.webp`. This plus importing from `../page` means deleting
  `generateMetadata` breaks the suite (`generateMetadata is not a function`).
- Narrow the `Metadata` union types in assertions (`openGraph.images` may be a single value or an
  array) with a small local cast/array normalisation so `tsc --noEmit` passes.
- Run: `yarn workspace website vitest run --project unit src/app/\(main\)/booking/\[type\]/__tests__/metadata.unit.test.ts`.
  Then temporarily comment out `generateMetadata` in `page.tsx`, re-run, confirm it fails, restore.
  Record both runs in the PR.

### 5. Playwright spec: `e2e/booking-og-metadata.integration.spec.ts`

- Modelled on `booking-flow.integration.spec.ts`; no DB fixtures needed (read-only page).
- Test "room2 booking link serves a room-specific card to WhatsApp":
  - `const res = await request.get("/booking/room2?checkIn=2026-10-06&checkOut=2026-10-08&source=gca", { headers: { "user-agent": "WhatsApp/2.23.20.0 A" } });`
  - From `await res.text()`, extract `<meta property="og:…" content="…">` values with a regex and
    assert: `og:title` contains `Private room 2`; `og:url` ends with `/booking/room2`; `og:image`
    ends with `/og/booking-room2.jpg`; `og:image:width` = `1200`; `og:image:height` = `630`;
    `og:image:type` = `image/jpeg`. Also assert those tags appear before `</head>` (what a
    non-JS fetcher reads).
  - `const img = await request.get("/og/booking-room2.jpg");` expect 200,
    `content-type` `image/jpeg`, `(await img.body()).length < 300_000`. (Fetch the path from the
    local server: the tag's absolute URL points at production via `metadataBase`, which does not
    have the file until merge.)
- Same check for room1 in a second test (or `for` loop).
- This spec runs automatically as the last step of the ADW test phase
  (`yarn workspace website test:integration`); it is not in CI, which is why the gating coverage
  is the unit test in step 4.

### 6. Build and confirm the route stays static

- `yarn turbo run build --filter=./apps/website` and capture the route table lines for
  `/booking/[type]`, `/booking/room1`, `/booking/room2`. They must be prerendered (● / ○ / ◐
  partial prerender, same symbol as before the change), not `ƒ`. Compare against a build of
  `HEAD` before the change if unsure. Paste the lines in the PR.
- If the build errors with a "metadata streaming while the page is prerenderable" error, the
  function is reading something dynamic; remove it (it must depend on `params` only).

### 7. Run the Validation Commands

- Run every command in `Validation Commands` and fix any failure.
- After the PR's Vercel preview is up, run the issue's curl checks against it:
  `curl -sL "https://<preview>/booking/room2?checkIn=2026-10-06&checkOut=2026-10-08&source=gca" -A "WhatsApp/2.23.20.0 A" | grep -oE '<meta [^>]*og:[^>]*>'`
  and `curl -sI "https://<preview>/og/booking-room2.jpg"` (content-type `image/jpeg`,
  content-length < 300000). Paste output in the PR.

## Testing Strategy

### Unit Tests

`src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts` (node pool, gated in CI and on
push) calls the page module's `generateMetadata` for room1, room2 and an unknown type, and asserts
the URL, canonical, image (JPEG, 1200×630, `image/jpeg`), title, description length, twitter card,
and that no field falls back to the root card.

### Test Coverage

- `src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts` (`*.unit.test.ts`) — catches the
  room page losing or never having its own card (fails today: `generateMetadata` is not exported
  from `page.tsx`), a WebP or dimensionless share image, a missing/wrong canonical URL, and
  `generateMetadata` throwing on an unknown room type.
- `apps/website/e2e/booking-og-metadata.integration.spec.ts` (Playwright) — catches what the unit
  test cannot: that Next actually emits those tags into `<head>` of the rendered HTML for a
  WhatsApp user agent (shallow merge with the root layout, `metadataBase` resolution), and that the
  committed `/og/booking-<type>.jpg` files exist and are served as `image/jpeg` under 300 KB. Fails
  today: the served `og:url` is `https://issebya.com` and `og:image` is `living_room.webp`.
- No `*.browser.test.tsx`: nothing visual in the page's DOM changes; metadata is not a component
  behaviour.

### Edge Cases

- Unknown `type` (`/booking/room3`): `generateMetadata` resolves (room1 card) instead of throwing;
  the page still redirects.
- Query string present (`?checkIn=…&source=gca`): card is identical to the bare room URL and
  `og:url` has no query string.
- Shallow merge: `openGraph`/`twitter` carry their own `title`/`description`, so they do not end up
  with no title after replacing the layout's objects.
- Description: room1's first two sentences fit in 160 chars; room2's first two do too, the third
  does not. The helper must never cut mid-sentence unless a single sentence exceeds 160.
- Image file size: must be < 300 KB each; verify after generation, not assumed.
- Route staticness under `cacheComponents: true`: no `searchParams`/`headers()`/`cookies()` read.

## Acceptance Criteria

- `/booking/room1` and `/booking/room2` each emit `og:title`/`twitter:title` = `Book Private room N - issebya.homes`, a ≤160-char room `og:description`, `og:url` and `<link rel="canonical">` = `https://issebya.com/booking/roomN`, `og:type` = `website`, `og:image` ending `/og/booking-roomN.jpg` with `og:image:width` 1200, `og:image:height` 630, `og:image:type` `image/jpeg`, `og:image:alt`, and `twitter:card` = `summary_large_image` with the same image.
- `apps/website/public/og/booking-room1.jpg` and `booking-room2.jpg` exist, are JPEG, 1200×630, each < 300000 bytes.
- `generateMetadata` does not throw for an unknown type.
- Build output lists `/booking/room1` and `/booking/room2` as prerendered, not `ƒ`.
- Root layout metadata, the blog's metadata, `ROOM_CONTENT`'s copy, and the GCA link format are unchanged.
- No new dependencies; no committed generation script; no build step.
- The unit test fails with `generateMetadata` removed and passes with it; the Playwright spec passes.
- All Validation Commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `sips -g pixelWidth -g pixelHeight -g format apps/website/public/og/booking-room1.jpg apps/website/public/og/booking-room2.jpg` - Both images are 1200×630 JPEG
- `stat -f "%z %N" apps/website/public/og/*.jpg` - Both images are under 300000 bytes
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit (including the new metadata test) and browser tests pass
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and `/booking/room1`, `/booking/room2` remain prerendered (inspect the route table)

## Notes

- No new dependency. Images are generated once with macOS `sips` (fallback: a one-off `node -e`
  with the `sharp` Next already installs) and committed; nothing runs at build time.
- Why not Next's `opengraph-image.jpg` file convention: a file in `booking/[type]/` applies to
  every param of the segment (same image for both rooms); a per-param `opengraph-image.tsx` would
  render a PNG via `ImageResponse` at request/build time. Two static JPEGs in `public/` are
  simpler and meet the JPEG requirement exactly.
- `metadataBase` is hardcoded to `SITE_URL`, so on a Vercel preview the rendered `og:image` points
  at production (`https://issebya.com/og/booking-roomN.jpg`), which returns 404 until this merges.
  Verify the image on the preview by its path on the preview host. Changing `metadataBase` is out of
  scope (root layout stays as is).
- WhatsApp caches previews per URL; since GCA links carry unique query strings, new links will pick
  up the new card immediately, but an already-sent link may keep the old one.
- Out of scope: dates/guest name in the card, the GCA link or message text, the home and blog
  cards, converting other WebP assets.
