# Statically Generated Blog with an Inline Booking Widget

**ADW ID:** fe1ca663
**Date:** 2026-09-19
**Specification:** specs/issue-76-adw-fe1ca663-sdlc_planner-blog-with-inline-booking-widget.md

## Overview

`apps/website` gains `/blog` and `/blog/[slug]`, both prerendered, backed by MDX files committed under `src/content/blog/`. A post can drop `<BookingWidget />` mid-article to render the real booking engine for both rooms inline, so a reader books from inside the post through the same calendar, pricing, Server Action and Stripe Checkout as `/booking/[type]`. `sitemap.ts` and `robots.ts` were added at the same time, driven by the same post registry.

## What Was Built

- `/blog`: an index listing every post newest first, with title, date and description.
- `/blog/[slug]`: one post per MDX file, prerendered via `generateStaticParams`, with per-post `generateMetadata` (canonical URL, Open Graph `article` tags, optional hero image).
- `<BookingWidget />`: a Server Component available to every post with no import, rendering `<BookingEngine>` for `room1` and `room2` behind the same `ErrorBoundary` + `Suspense`/`BookingEngineSkeleton` pair that `booking/[type]/page.tsx` uses.
- `<RoomSwitcher>`: a small `"use client"` tablist that toggles which of the two prerendered engines is on screen. Both engines arrive as `ReactNode` props, so switching is pure client state and issues no request. The rendered panel is keyed on the active room, which is what actually makes the switch a switch (see below).
- A validated post registry: `zod`-checked frontmatter expressed as `export const meta = {...}` inside each `.mdx` file, so a malformed post fails the build.
- `sitemap.ts` and `robots.ts`, plus a single `SITE_URL` constant now also feeding `layout.tsx`'s `metadataBase` and Open Graph URLs.
- A `Blog` link in the site header, and shared tab styling extracted so the booking page's `<Link>` tabs and the widget's `<button>` tabs cannot drift apart visually.
- Two seed posts: `a-weekend-in-almocageme.mdx` (uses the widget) and `house-notes-the-shared-kitchen.mdx`.

## Technical Implementation

### Files Modified

- `apps/website/src/lib/blog/schema.ts` (new): `zod` frontmatter contract (`title`, `description`, `date`, `slug`, optional `hero`), plus `toBlogPost`, `sortPostsByDateDesc` and `assertUniqueSlugs`. Imports no MDX and does no rendering, which is what keeps it runnable in the vitest node pool.
- `apps/website/src/lib/blog/posts.ts` (new): the registry. Explicit imports of each post module, validation at module scope, exports `allPosts` and `getPostBySlug`.
- `apps/website/src/app/(main)/blog/page.tsx` (new): the index route.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx` (new): the post route, `generateStaticParams`, `generateMetadata`, `notFound()` for unknown slugs.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` (new): builds both rooms' engine nodes and hands them to the switcher.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` (new): the client tablist, with a PostHog `room_tab_clicked` capture.
- `apps/website/src/mdx-components.tsx` (new): required by `@next/mdx` in the App Router. Maps markdown elements onto the site's existing typography and puts `BookingWidget` in scope for every post.
- `apps/website/src/types/mdx.d.ts` (new): declares `export const meta: unknown` on `*.mdx`, deliberately untyped so the runtime schema stays the single source of truth.
- `apps/website/src/app/sitemap.ts`, `apps/website/src/app/robots.ts` (new): static route handlers at the root of `src/app/`, outside the `(main)` group.
- `apps/website/src/lib/site.ts` (new): the `SITE_URL` constant.
- `apps/website/src/app/layout.tsx`: adds `metadataBase` and switches hardcoded origins to `SITE_URL`.
- `apps/website/src/app/ui/tab-styles.ts` (new) and `TabLink.tsx`, `Header.tsx`: shared `tabStateClasses` helper and the new `Blog` nav link.
- `apps/website/next.config.ts`: wraps the config with `createMDX({})`, inside `withSentryConfig`. `pageExtensions` is left alone on purpose, since posts are imported modules and not routed `page.mdx` files.
- `apps/website/src/lib/ical-feed-url.ts` (new), `src/lib/availability.ts`, `src/instrumentation.ts`, `.env.example`: root-relative dev iCal feeds are now resolved against this process's own `PORT` at fetch time instead of a baked-in `3000`.
- `apps/website/playwright.config.ts`: `workers: 1`.
- `lefthook.yml`, `.prettierignore`: format `.mdx` on commit; ignore Playwright and vitest output directories.

### Key Changes

- **No request-time IO anywhere in either route.** The registry is explicit imports, not a `readdir`, so both routes stay in the static shell and `content/` never has to be traced into a serverless bundle.
- **Frontmatter is a module export, not YAML.** `@next/mdx` does not parse YAML frontmatter but does support plain module exports, so `export const meta = {...}` costs no extra dependency (no `gray-matter`, no remark frontmatter plugins) and sidesteps Turbopack's restriction that remark plugins can only be passed by serialisable name.
- **Validation is a build gate.** `postMetaSchema.parse` runs at module scope, so a bad post throws while the route module is evaluated. Duplicate slugs throw too. No route defends against missing fields at render time.
- **Both engines are props, not children of a client component.** That server-into-client interleaving puts both rooms' availability into the page's static payload, which is why a room switch issues no request. The widget reuses the real `BookingEngine`, so it inherits the existing `availability-${room}` cache tag and is invalidated by the Stripe webhook and `api/bookings/direct` exactly as the booking page is.
- **Only the active room is mounted.** Keeping the inactive one hidden would duplicate every `aria-label` on the page and leave locators ambiguous for tests and screen readers. The trade is that a date selection is dropped on switch, which is also correct: blocked dates differ per room.
- **The panel is keyed on the active room, or the switch is cosmetic.** Both rooms' nodes are the same component type in the same position, so without a key React reconciles them as one instance and updates its props instead of remounting. `BookingClient` seeds its blocked dates, its default nights and its expanded flag from props on mount only, so an unkeyed panel showed room 2's tab with room 1's calendar, room 1's defaults and room 1's in-progress selection, letting a guest submit a range that is not bookable for the room they picked (issue #79). The key is the caller-side fix for a caller-side mistake: `BookingClient` deliberately gained no prop-sync effect, since a fresh `blockedDates` array identity on any later render would wipe a guest's half-finished selection mid-interaction.
- **Room state is component state, not URL state.** Putting it in `searchParams` would opt the post route out of the static shell.
- **The iCal fix is incidental but load-bearing.** Dev and E2E feeds point at fixture `.ics` files this app serves itself, so their URL must name the port the run is actually listening on. The hardcoded `3000` broke every booking spec in a non-3000 worktree on a path unrelated to what those specs test.

## How to Use

To add a post:

1. Create `apps/website/src/content/blog/<slug>.mdx`.
2. Start it with the frontmatter export:
   ```js
   export const meta = {
     title: "...",
     description: "...", // 1 to 200 chars, doubles as the meta description
     date: "2026-08-14", // YYYY-MM-DD calendar day, never a Date
     slug: "<slug>", // lowercase kebab-case, must match the filename
     hero: { src: "/terrace.webp", alt: "...", width: 1200, height: 800 }, // optional
   };
   ```
3. Write the body in markdown. To put the booking engine mid-article, write `<BookingWidget />` on its own line between paragraphs. No import is needed.
4. Add an import for the new module to `apps/website/src/lib/blog/posts.ts` and a `toBlogPost(...)` entry to the `posts` array. This step is not optional: the registry is deliberately explicit, so a post that is not imported does not exist.
5. The index, the post route, `generateStaticParams` and the sitemap pick it up from there.

A reader lands on a post, reads it, picks `room 1` or `room 2` in the widget, picks nights on the same calendar the booking page uses, and is sent to Stripe Checkout without leaving the article.

## Configuration

- No new environment variables. `SITE_URL` in `src/lib/site.ts` is a constant, not env-driven, because `sitemap.ts`, `robots.ts` and post canonicals cannot read the request without turning dynamic. Note it is `https://issebya.com` while the brand is `issebya.homes`, matching what `layout.tsx` has always emitted. Changing that one line updates the layout metadata, every canonical, the sitemap and robots together.
- New dependencies: `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, and `@types/mdx` as a dev dependency.
- The dev and E2E iCal feed values in `.env.example` are now root-relative paths (`/dev-ical/room1-airbnb.ics`). A local `.env.development` still carrying `http://localhost:3000/...` will point a non-3000 run at the wrong server. Production OTA feeds are absolute URLs and pass through untouched.

## Testing

- Unit (`yarn turbo run test --filter=website`): `src/lib/blog/__tests__/schema.unit.test.ts` covers the frontmatter contract, date and slug validation, date-descending sort and the duplicate-slug guard.
- Browser: `src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` asserts room 1's panel is on screen first, that clicking the room 2 tab swaps which panel is rendered, and that `aria-selected` follows the active tab. Those three use stateless stand-in panels, which cannot tell a remount from a props update, so a fourth test drives the real composition: two `BookingClient` panels with deliberately different blocked windows, asserting that a day blocked for room 2 is selectable on the room 1 tab and disabled plus `calendar-date-blocked` on the room 2 tab, and that the engine comes back collapsed after the switch.
- E2E (`yarn workspace website test:integration`): `e2e/blog-booking-flow.integration.spec.ts` checks the index orders posts newest first, drives a full booking from inside a post through to the (mocked) Stripe Checkout URL, asserts a room switch produces neither an availability fetch nor an RSC round trip, and asserts that a range selected on room 1 does not survive the switch to room 2. The last two are a pair on purpose: cheapness alone was a property the unkeyed switcher satisfied trivially, because it did not switch anything.

## Notes

- The whole change lands in `apps/website`; the only files outside it are the repo-root `lefthook.yml`, `.prettierignore` and the spec.
- Playwright now runs with a single worker. Separate spec *files* previously ran in parallel against one dev server, one shared local Supabase and one process-global `__e2eIcalShouldFail` toggle. Two real collisions were observed: the existing dates-unavailable test seeds a confirmed room1 booking for the same room and window the new blog booking test tries to book, and any concurrent room1 booking fails `checkAvailability`'s unverifiable gate while the iCal-failure toggle is on. Both are scheduling artifacts, not app bugs.
- `dynamicParams` is left unset on the post route on purpose: `notFound()` already handles an unknown slug, and leaving it off keeps the route free of dynamic config flags under `cacheComponents`.
- The sitemap omits `/` (it redirects), `/guest-info` and `/checkin/*` (already noindex) and all `/api` routes, and carries no `lastModified` on static entries since `new Date()` there would churn on every build.
