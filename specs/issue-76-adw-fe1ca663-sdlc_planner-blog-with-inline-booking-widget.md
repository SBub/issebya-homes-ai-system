# Feature: Statically generated blog with an inline booking widget

## Metadata

issue_number: `76`
adw_id: `fe1ca663`
issue_json: `{"number":76,"title":"Add a statically generated blog with an inline booking widget","body":"Add /blog (index) and /blog/[slug] (post) to apps/website as statically generated routes backed by MDX files in the repo, each post able to embed a <BookingWidget /> mid-article that reuses BookingEngine/BookingClient/BookingPricing/getAvailability unchanged, plus sitemap.ts and robots.ts. Content lives in the repo as MDX, the reader picks the room inside the widget, the checkout path is unchanged, and the post route must stay in the static shell."}`

## Feature Description

`apps/website` gets a blog:

- `/blog` lists every post, newest first.
- `/blog/[slug]` renders one post from an `.mdx` file committed to the repository, prerendered via `generateStaticParams`.
- Inside a post, between paragraphs, an author can write `<BookingWidget />`. It renders the existing booking engine for both rooms as part of the page's static shell, with a small client-side switcher choosing which one is on screen. A reader books from inside the article: same calendar, same pricing, same Server Action, same Stripe Checkout as `/booking/[type]`.
- `sitemap.ts` and `robots.ts` are added (neither exists today), and every post carries its own `metadata` with a canonical URL and Open Graph tags.

Nothing about availability, pricing, checkout or caching is duplicated or reimplemented. The widget is a thin arrangement of components the booking page already renders.

Value: the site's only conversion surface today is `/booking/[type]`. Editorial content (area guides, surf reports, house notes) is the cheapest organic-search entry point a small rental has, and a reader who has just read why Almocageme is worth a weekend is the most likely to book. Making them click through to another page to do it loses most of that intent.

## User Story

As a visitor who arrived on an issebya.homes article from search
I want to pick a room and dates and pay without leaving the article
So that I can book while I am still interested, instead of being sent to a separate booking page and losing my place

## Problem Statement

`apps/website` has no blog and no content infrastructure. Its dependency list carries nothing for authoring or rendering content, there is no `sitemap.ts` and no `robots.ts`, and the only route that can take a booking is `/booking/[type]`.

Adding content is not the hard part. The hard part is adding it without breaking three things that are currently correct and quietly easy to break:

1. **Static generation.** `booking/[type]` is prerendered and reads availability through a `"use cache"` function. A single `cookies()`, `headers()` or `searchParams` read in the new post route converts that cached read into a per-request one, silently, with no error.
2. **A single source of availability and price.** `getAvailability` merges iCal feeds with the `bookings` table in one place, and `pricing` is one workspace package. A second copy inside a blog widget will drift and will eventually be wrong about money or occupancy.
3. **Cache invalidation.** The Stripe webhook and `api/bookings/direct` call `revalidateTag("availability-${room}")`. A widget that cached availability separately would keep showing nights that were sold minutes ago.

## Solution Statement

Add MDX to the website through `@next/mdx`, with post content in `src/content/blog/*.mdx` and per-post frontmatter expressed as an `export const meta = {...}` object inside the MDX file (the frontmatter mechanism `@next/mdx` supports natively), validated by `zod` at module scope so a malformed post fails the build.

A small registry module, `src/lib/blog/posts.ts`, imports each post module, runs its `meta` through the schema and exposes a sorted, typed list. `/blog` maps over it; `/blog/[slug]` uses it for `generateStaticParams`, `generateMetadata` and rendering. No filesystem reads, no `gray-matter`, no remark plugins, and therefore no request-time IO anywhere in either route.

`<BookingWidget />` is registered in `src/mdx-components.tsx`, so every post can use it without an import. It is a Server Component that renders `<BookingEngine roomType="room1" />` and `<BookingEngine roomType="room2" />` (each behind the same `ErrorBoundary` + `Suspense`/`BookingEngineSkeleton` pair the booking page uses) and passes both as `ReactNode` props into a `"use client"` `RoomSwitcher`. Because both nodes are props, both rooms' availability is already serialised into the static payload, so switching rooms is pure client state and issues no request. Because the engine is the real `BookingEngine`, it participates in the existing `availability-${room}` cache tag automatically, and booking from a post goes through `submitBooking` and Stripe exactly as it does from `/booking/[type]`.

`sitemap.ts` and `robots.ts` are plain static route handlers driven by the same registry plus a single `SITE_URL` constant.

## Relevant Files

Read before implementing:

- `AGENTS.md` (repo root) - yarn only, conventional commits with no `Co-Authored-By`, lefthook gates, the four-file documentation convention.
- `apps/website/AGENTS.md` - read Next.js docs in `node_modules/next/dist/docs/` before Next.js work, Server Components by default, `next/image` for all images, zod at boundaries, no Radix. Also the calendar-days-are-strings rule, which the post `date` field follows.
- `apps/website/ENGINEERING.md` - why the booking page renders the way it does, before wrapping any of it in something new.
- `apps/website/app_docs/nextjs-patterns-guide.md` - `PageProps<"/blog/[slug]">` for route params, when `generateStaticParams` is appropriate, Server Components by default, static values at module scope, and the `<Link>`-not-`<button>` rule for tab _navigation_ (see the deviation note in Notes).
- `apps/website/app_docs/component-patterns-guide.md` - extract shared JSX, data-driven components.
- `apps/website/app_docs/zod-validation-guide.md` - schema shape and the date-string pattern used for post dates.
- `apps/website/app_docs/branding-guidelines.md` - `issebya.homes` lowercase, page titles as `"Page Name - issebya.homes"`.
- `apps/website/app_docs/data-fetching-client.md` - reading data in a Server Component, and not fetching from a Client Component.
- `apps/website/app_docs/import-patterns-guide.md` - destructured imports.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md`, `apps/website/app_docs/testing/e2e_example.md` - test shapes for the three layers.
- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md` - the `Suspense`/`BookingEngineSkeleton` contract around `BookingEngine`, which the widget must mirror rather than reinvent.
- `node_modules/next/dist/docs/01-app/02-guides/mdx.md` - the `@next/mdx` setup, the `mdx-components.tsx` requirement, exports-as-frontmatter, Turbopack plugin constraints.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md` and `.../robots.md` - the two file conventions being added.

Files that are read for context and must not change:

- `apps/website/src/lib/availability.ts` - `getAvailability` keeps `"use cache"`, `cacheLife("minutes")` and both cache tags. Not touched.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngine.tsx`, `BookingClient.tsx`, `BookingPricing.tsx`, `BookingEngineExpanded.tsx`, `BookingEngineSkeleton.tsx` - reused as-is. `BookingEngine` already takes `roomType` as a prop, not a route param.
- `apps/website/src/app/(main)/booking/[type]/actions.ts` - the only checkout path. Not touched.
- `apps/website/src/app/(main)/booking/[type]/page.tsx` - the reference for how the engine is wrapped (`ErrorBoundary` with the WhatsApp fallback, `Suspense` with `BookingEngineSkeleton`). Not touched.
- `apps/website/src/app/api/webhook/stripe/route.ts`, `apps/website/src/app/api/bookings/direct/route.ts` - the two `revalidateTag("availability-${room}")` call sites the widget inherits for free.
- `apps/website/src/app/api/e2e-ical-mock/route.ts` - read its comment before touching caching; it documents the `generateStaticParams` prewarm interaction.

Files to modify:

- `apps/website/next.config.ts` - wrap the config with `createMDX()` inside the existing `withSentryConfig(...)` call.
- `apps/website/src/app/layout.tsx` - use the new `SITE_URL` constant and add `metadataBase`.
- `apps/website/src/app/ui/Header.tsx` - add a `Blog` nav link so the section is reachable.
- `apps/website/src/app/ui/TabLink.tsx` - switch its inline active/inactive class expression to the shared helper so the widget's switcher cannot drift from it visually.
- `knip.json` - `ignoreDependencies` for the MDX packages that are config-only, and `ignoreUnresolved` for `.mdx` imports if knip reports them.
- `.prettierignore` and/or `lefthook.yml` - only if prettier cannot parse `.mdx` cleanly (see the task; this is a decision to make once, with the outcome recorded in a comment).

### New Files

- `apps/website/src/mdx-components.tsx` - required by `@next/mdx` in the App Router. Maps markdown elements to brand-styled JSX and exposes `BookingWidget` to every post without an import.
- `apps/website/src/lib/site.ts` - `SITE_URL`, the one place the public origin is written down, used by the root layout metadata, per-post canonicals, `sitemap.ts` and `robots.ts`.
- `apps/website/src/lib/blog/schema.ts` - `postMetaSchema` (zod), the `BlogPost` type, `toBlogPost`, `sortPostsByDateDesc`, `assertUniqueSlugs`. Pure, imports no `.mdx`, therefore unit-testable in the node pool.
- `apps/website/src/lib/blog/posts.ts` - imports the `.mdx` modules, validates each `meta`, exports `allPosts` and `getPostBySlug`.
- `apps/website/src/lib/blog/__tests__/schema.unit.test.ts` - the frontmatter contract.
- `apps/website/src/content/blog/<slug>.mdx` x2 - the two example posts.
- `apps/website/src/app/(main)/blog/page.tsx` - the index.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx` - the post route.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` - Server Component, renders both rooms' engines and hands them to the switcher.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` - `"use client"`, tablist over two prerendered panels.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` - the switching behaviour.
- `apps/website/src/app/ui/tab-styles.ts` - the shared active/inactive tab class expression used by `TabLink` and `RoomSwitcher`.
- `apps/website/src/app/sitemap.ts`, `apps/website/src/app/robots.ts` - the two metadata file conventions.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` - the in-post booking journey.

## Implementation Plan

### Phase 1: Foundation

Get MDX compiling and the content contract enforced, with nothing user-visible yet. Install the MDX pipeline, wire `createMDX` into `next.config.ts` under the existing Sentry wrapper, add the required `mdx-components.tsx`, and add the `zod` frontmatter schema plus its unit test. At the end of this phase `yarn turbo run typecheck --filter=./apps/website` passes with an `.mdx` file importable and its `meta` validated, and the tooling gates (lint, knip, prettier) are already settled rather than left to the end, because MDX is a new file type for every one of them.

### Phase 2: Core Implementation

Build the two routes and the widget. The registry drives `/blog`, `generateStaticParams`, `generateMetadata` and `sitemap.ts` from one list. The widget is assembled out of existing components only: `BookingEngine` per room, each behind the `ErrorBoundary` + `Suspense` pair copied from the booking page, handed as props to a client switcher. Two example posts are written, one of them embedding the widget mid-article. Styling follows the existing pages: `font-hand` headings, `text-sm leading-relaxed` body, the `#f0eeea` ground the layout already sets.

### Phase 3: Integration

Make the section reachable and indexable, and prove the contracts. Add the header link, `sitemap.ts` and `robots.ts`. Add the browser test for the switcher and the Playwright spec for the end-to-end in-post booking, including the assertion that switching rooms issues no request. Run the full gate set plus a production build, and read the build output to confirm `/blog` and `/blog/[slug]` are prerendered rather than dynamic.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the documentation listed in Relevant Files

- Read `AGENTS.md`, `apps/website/AGENTS.md`, and the `app_docs` entries listed above.
- Read `node_modules/next/dist/docs/01-app/02-guides/mdx.md` in full, plus the `sitemap.md` and `robots.md` file-convention docs. Do not rely on recalled Next.js API shapes.
- Read `apps/website/src/app/(main)/booking/[type]/page.tsx` and `ui/BookingEngine.tsx` and note exactly how the engine is wrapped. The widget mirrors it.

### 2. Install the MDX pipeline

- `yarn workspace website add @next/mdx @mdx-js/loader @mdx-js/react`
- `yarn workspace website add -D @types/mdx`
- Add no frontmatter parser. `@next/mdx` supports plain module exports as frontmatter, which is what this feature uses, so `gray-matter`, `remark-frontmatter` and `remark-mdx-frontmatter` are all unnecessary. Record that reasoning in a comment in `src/lib/blog/posts.ts`.
- Do not add remark or rehype plugins. Next 16 builds with Turbopack, which can only take plugins by serialisable string name, and none are needed here.

### 3. Wire MDX into `next.config.ts`

- Import `createMDX from "@next/mdx"` and build `const withMDX = createMDX({})`.
- Change the default export to `withSentryConfig(withMDX(nextConfig), { ...existing options })`. Order matters: MDX wraps the plain config, Sentry wraps the result. Leave every existing option (`reactStrictMode`, `transpilePackages`, `turbopack.root`, `cacheComponents`) untouched.
- Do **not** add `pageExtensions`. Posts are imported modules under `src/content/`, not routed `page.mdx` files, so widening the routing extensions buys nothing and widens the app-directory routing surface.

### 4. Add `src/mdx-components.tsx`

- Export `useMDXComponents(): MDXComponents` returning a `components` object, per the Next 16 signature in the MDX doc (no arguments).
- Map the markdown elements a post actually uses to brand-styled JSX, matching the existing pages rather than inventing a scale: `h1`/`h2`/`h3` with `font-hand font-bold` at descending sizes, `p` with `text-sm leading-relaxed`, `a` with `underline hover:text-gray-600`, `ul`/`ol`/`li`, `blockquote`, `hr`, and `img` mapped to `next/image` (required by `apps/website/AGENTS.md`; give it `sizes="100vw"` and `style={{ width: "100%", height: "auto" }}` as the doc shows, with explicit width/height from the MDX author).
- Add `BookingWidget` to the same map so posts can write `<BookingWidget />` with no import. It is added in step 8; stub it or write the components file after step 8 if that ordering is easier.
- `mdx-components.tsx` is mandatory for `@next/mdx` in the App Router. Without it MDX will not compile at all.

### 5. Add `src/lib/site.ts`

- `export const SITE_URL = "https://issebya.com";` with a comment saying this is the one place the public origin is written down, and that `app_docs/dynamic-url-construction.md`'s derive-from-request rule does not apply here: `sitemap.ts`, `robots.ts` and a canonical URL must not read the request, because reading it would opt those routes out of static generation, which is the opposite of what they are for.
- Update `src/app/layout.tsx` to add `metadataBase: new URL(SITE_URL)` and to build the existing `openGraph.url` and image URLs from `SITE_URL` instead of the two hardcoded `https://issebya.com` literals. Do not otherwise restructure that metadata object.

### 6. Add the frontmatter schema, `src/lib/blog/schema.ts`

- `postMetaSchema` with:
  - `title`: non-empty, trimmed, max ~120 chars.
  - `description`: non-empty, trimmed, max ~200 chars (it is the meta description and the index blurb).
  - `date`: a calendar day, validated exactly like `calendarDaySchema` in `src/lib/shared/schemas/booking.ts` does it, a `/^\d{4}-\d{2}-\d{2}$/` regex plus a `.refine` that `fromCalendarDay(day)` is a real date. This follows `apps/website/AGENTS.md`'s rule that a calendar day is a string, never a `Date`, and rejects well-shaped nonsense like `2026-02-31`.
  - `slug`: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (kebab-case, URL-safe).
  - `hero`: optional object `{ src, alt, width, height }` where `src` starts with `/`, `alt` is non-empty and the dimensions are positive integers. `next/image` needs the dimensions for a remote-style string `src`, and the alt text is not optional for a decorative-looking but content-bearing hero.
- `export type BlogPostMeta = z.infer<typeof postMetaSchema>` and `export type BlogPost = BlogPostMeta & { Content: ComponentType }`.
- `toBlogPost(meta: unknown, Content: ComponentType): BlogPost` runs `postMetaSchema.parse(meta)` (parse, not safeParse: a bad post must throw) and returns the post. Give it a comment explaining that throwing here is the mechanism by which a malformed post fails the build.
- `sortPostsByDateDesc(posts: BlogPost[]): BlogPost[]` returns a new array sorted newest first. Sort on the `yyyy-MM-dd` string directly; it is lexicographically ordered, so no `Date` needs to be constructed.
- `assertUniqueSlugs(posts: BlogPost[]): void` throws a message naming the duplicate slug. Two posts on one URL is a build-time mistake, not a runtime 404.
- This file imports no `.mdx` and no React rendering, only `zod`, `fromCalendarDay` and a `ComponentType` type, which is what keeps it runnable in the node test pool.

### 7. Add the unit test `src/lib/blog/__tests__/schema.unit.test.ts`

Follow `app_docs/testing/unit_test_spec_format.md`. Cover:

- A fully valid `meta` parses and `toBlogPost` returns it with `Content` attached.
- `toBlogPost` throws when `title` is missing, when `description` is empty, when `date` is `"19-09-2026"`, when `date` is `"2026-02-31"`, when `slug` is `"Not A Slug"`, and when `hero` is present but missing `alt`.
- `sortPostsByDateDesc` puts the newest first and does not mutate its input.
- `assertUniqueSlugs` throws on a duplicate slug and names it.

### 8. Add `src/app/(main)/blog/ui/BookingWidget.tsx`

- Server Component, no `"use client"`.
- Renders a framed `<aside>` that reads as part of the article rather than an ad slot: a short lead-in line, the switcher, and nothing that looks like a banner. Use the existing visual vocabulary (a hairline or dashed border in the manner of `Callout`, `font-hand` for its heading, the page's own background) rather than a new card style.
- For each of `room1` and `room2`, build the node exactly as `booking/[type]/page.tsx` does:
  - a Sentry `<ErrorBoundary>` whose fallback is the same short "Booking is temporarily unavailable ... reach out to us on `<WhatsAppLink />`" message, wrapping
  - `<Suspense fallback={<BookingEngineSkeleton />}>` wrapping `<BookingEngine roomType={...} />`.
    The `Suspense` boundary is not decorative: `BookingClient` calls `useSearchParams()`, which needs one to stay out of the way of static rendering, and `app_docs/feature-675f0da1-restore-booking-engine-skeleton.md` records why the fallback is the skeleton and not `null`.
- Pass the two nodes to `<RoomSwitcher room1={...} room2={...} />` as props. This is the same server-into-client interleaving already used for `BookingClient`'s `pricing` prop, and it is what puts both rooms' availability in the static payload. Add a comment saying so, and saying that this is why switching rooms costs no request.
- Import `BookingType` from `@/lib/shared/types/booking` for the room values rather than writing string literals.
- Do not pass a room down from the post. Any post converts for either room, per the issue's decision.

### 9. Add `src/app/ui/tab-styles.ts` and use it from `TabLink`

- Export one function returning the active/inactive class fragment currently inlined in `TabLink` (`bg-[#d9b98b]` when active, `text-gray-600 hover:text-black` otherwise).
- Change `TabLink` to call it. Behaviour and output are unchanged; this exists so the widget's `<button>` tabs and the booking page's `<Link>` tabs cannot drift apart visually.

### 10. Add `src/app/(main)/blog/ui/RoomSwitcher.tsx`

- `"use client"`. Props: `room1: ReactNode`, `room2: ReactNode`.
- `useState<"room1" | "room2">("room1")`. No URL state: reading `searchParams` in the post route is forbidden by the issue's constraints and would opt the page out of the static shell.
- Render a `role="tablist"` of two `<button type="button" role="tab">` elements labelled `room 1` / `room 2`, styled through `tab-styles.ts`, with `aria-selected` and `aria-controls` set, and the panel as `role="tabpanel"` with a stable `id` and `aria-labelledby`.
- Render only the active room's node. Both nodes are already serialised into the payload because they are props, so conditional rendering costs no request and keeps the DOM free of a second, hidden booking form (which would otherwise duplicate every `aria-label` on the page and make locators ambiguous for tests and screen readers alike). Note in a comment that unmounting the inactive engine deliberately drops any date selection, because blocked dates differ per room and carrying a selection across would show the guest a range that may not be bookable.
- On a real switch (not a click on the already-active tab), `posthog.capture("room_tab_clicked", { room_type: <id> })`, matching the existing convention in `TabsDesktop`/`TabsMobile` exactly. Do not invent a new event name.

### 11. Write the two example posts under `src/content/blog/`

- Two `.mdx` files, each opening with `export const meta = { title, description, date, slug }` (plus `hero` on one of them, using an existing image from `apps/website/public`).
- One post embeds `<BookingWidget />` between two paragraphs, roughly two thirds of the way down, which is the case the feature exists for. The other has no widget, which proves a post without one still builds and renders.
- Copy rules: brand is `issebya.homes`, lowercase, per `app_docs/branding-guidelines.md`. No em-dashes anywhere in the copy; use commas, periods, parentheses or colons. Keep each post short, this is scaffolding to prove the feature, not an editorial exercise. Use dates in the past relative to the current date so the index ordering is meaningful.
- Content location note: the issue suggests `apps/website/content/blog/`. Use `apps/website/src/content/blog/` instead, so posts resolve through the existing `@/*` tsconfig path (`@/content/blog/<slug>.mdx`) with no new path alias and no bundler configuration. Everything else about the suggestion is followed.

### 12. Add the registry `src/lib/blog/posts.ts`

- For each post: `import Content, { meta } from "@/content/blog/<slug>.mdx";` (the `.mdx` extension is required in the import).
- Build the list with `toBlogPost(meta, Content)` for each, call `assertUniqueSlugs`, and export `allPosts = sortPostsByDateDesc(...)` plus `getPostBySlug(slug: string): BlogPost | undefined`.
- Add a header comment covering both decisions that are not obvious from the code: why the list is explicit rather than a filesystem scan (no request-time or build-time IO, so neither route can slip out of the static shell, and no reliance on `content/` being traced into a serverless bundle), and why frontmatter is a module export rather than YAML (it is what `@next/mdx` supports natively, so it costs zero extra dependencies and no Turbopack-incompatible remark plugin). Say plainly that adding a post means adding an import here.

### 13. Add the index route `src/app/(main)/blog/page.tsx`

- Server Component. `export const metadata` with `title: "Blog - issebya.homes"` and a description, per the branding doc's title pattern.
- Map over `allPosts`: each entry is a `<Link href={`/blog/${slug}`}>` showing the title (`font-hand`), the date (formatted for display via `fromCalendarDay` plus `date-fns` `format`, never `new Date(day)`), and the description.
- Wrap in a centred `max-w-2xl` column with the same padding rhythm the other content pages use.
- Handle the empty-list case with a short line rather than an empty page.
- Read nothing from the request: no `cookies()`, no `headers()`, no `searchParams`, and no `export const dynamic`.

### 14. Add the post route `src/app/(main)/blog/[slug]/page.tsx`

- `export function generateStaticParams()` returning `allPosts.map(({ slug }) => ({ slug }))`.
- `export async function generateMetadata(props: PageProps<"/blog/[slug]">): Promise<Metadata>` returning `title: "<post title> - issebya.homes"`, the post description, `alternates: { canonical: `${SITE_URL}/blog/${slug}` }`, and `openGraph` with `type: "article"`, `publishedTime`, the canonical `url`, and the hero image when the post has one. Return `{}` or a not-found title for an unknown slug rather than throwing.
- The default export takes `PageProps<"/blog/[slug]">` (per `app_docs/nextjs-patterns-guide.md`, not a hand-written params type), awaits `props.params`, looks the post up with `getPostBySlug`, calls `notFound()` when it is missing, and renders `<article>` with the title, formatted date, optional hero via `next/image`, and `<Content />`.
- Do not add `export const dynamic`, do not read `searchParams`, `cookies()` or `headers()`. If the build output later shows this route as dynamic, the cause is one of those, not the cached availability read: `booking/[type]` already proves a `"use cache"` read is compatible with prerendering.
- Prefer leaving `dynamicParams` unset and letting `notFound()` handle unknown slugs, which keeps this route free of dynamic config flags under `cacheComponents`.

### 15. Add a browser test `src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`

Follow `app_docs/testing/component_test_spec_format.md` and the existing `BookingClient.browser.test.tsx` for shape. Render `<RoomSwitcher room1={<p>room one panel</p>} room2={<p>room two panel</p>} />` and assert:

- room 1's panel is visible on first render and room 2's is not.
- clicking the `room 2` tab shows room two's panel and hides room one's.
- `aria-selected` follows the active tab.

This runs in the browser pool against real DOM and real click handling, which is what the behaviour is.

### 16. Add the Playwright spec `apps/website/e2e/blog-booking-flow.integration.spec.ts`

Model it on `e2e/booking-flow.integration.spec.ts`: `baseURL` is already configured, `E2E_MOCK_STRIPE=true` is already set for the spawned dev server by `playwright.config.ts`, and the same `page.route("https://checkout.stripe.com/**", ...)` fulfilment keeps the browser off real Stripe. Compute dates the same way (relative to today, so the spec does not go stale). Keep it to three tests:

1. **Index lists posts newest first.** Visit `/blog`, assert both post titles are present and that the newer one appears first in the DOM.
2. **Booking completes from inside a post.** Visit the post that embeds the widget, confirm the widget renders inside the article, expand it, pick check-in and check-out, fill name, email and WhatsApp number, click confirm, and assert navigation to the mocked `https://checkout.stripe.com/**`. This is the same destination the booking page reaches, which is the point of the test.
3. **Switching rooms issues no request.** On the same post, after the page has settled, start collecting `page.on("request")`, click the `room 2` tab, wait for room 2's panel to be the selected tab, and assert no collected request URL matches `/api/availability` or contains `_rsc=`. That is the direct, observable form of "both rooms are already in the static payload".

Do not add an agent-driven `e2e/*.md` journey. Everything here is deterministic and expressible as a spec, which is this repository's default regression layer.

### 17. Add `src/app/sitemap.ts` and `src/app/robots.ts`

- `sitemap.ts`: default-export a function returning `MetadataRoute.Sitemap` built from `SITE_URL` plus `/blog`, every `/blog/${slug}` (with `lastModified` from the post's own date via `fromCalendarDay`), `/booking/room1`, `/booking/room2`, `/contact`, `/terms-and-conditions` and `/privacy-policy`. Omit `/` (it redirects), `/guest-info` and `/checkin/*` (both already `noindex`), and every `/api` route. Do not use `new Date()` for the non-post entries; a value that changes on every build is noise in a sitemap.
- `robots.ts`: allow `/`, disallow `/api/`, `/guest-info`, `/checkin`, and `/monitoring` (the Sentry tunnel route configured in `next.config.ts`), and point `sitemap` at `${SITE_URL}/sitemap.xml`.
- Both go at the root of `src/app/`, not inside the `(main)` group. Neither may read the request.

### 18. Make the section reachable

- Add a `Blog` link to the nav in `src/app/ui/Header.tsx`, following the existing `isActive` pattern (`isActive("/blog")`).

### 19. Settle the tooling for a new file type

Run each gate and fix what it reports, rather than assuming:

- `yarn prettier --check .` - `.mdx` is new to this repo. Run `yarn prettier --write` on the two post files first and read the result. If prettier's mdx parser leaves them correct, keep them formatted and add `mdx` to the `format` glob in `lefthook.yml` so committed posts stay that way. If it fails to parse or alters MDX semantics (the `export const meta` block is the thing to check), add `apps/website/src/content/**/*.mdx` to `.prettierignore` with a one-line comment saying why. Either outcome is acceptable; leaving it undecided is not.
- `yarn turbo run lint --filter=./apps/website` - ESLint flat config lints only the JS/TS extensions its configs declare, so `.mdx` is skipped with no configuration change. Confirm that is what actually happens and change nothing if so.
- `yarn knip` - expect `@mdx-js/loader`, `@mdx-js/react` and `@types/mdx` to be reported as unused, because they are resolved by the bundler and the type system rather than imported. Add exactly those three to `ignoreDependencies` under `apps/website` in `knip.json`, next to the existing entries. `@next/mdx` is imported by `next.config.ts` and should not need an entry. If knip also reports unresolved `.mdx` imports from `src/lib/blog/posts.ts`, add `"ignoreUnresolved": ["\\.mdx$"]`. Add nothing that is not actually reported.

### 20. Run the production build and read its output

- `yarn turbo run build --filter=./apps/website`
- Find the route table and confirm `/blog` and `/blog/[slug]` are marked prerendered (the static/SSG marks), not dynamic (`ƒ`), and that each post slug is listed. Copy those lines verbatim for the pull request. If either route is dynamic, the cause is request-time input somewhere in the route or its imports; find and remove it rather than working around it with a config flag.
- Confirm `/sitemap.xml` and `/robots.txt` appear.

### 21. Verify the frontmatter build gate by hand

- Temporarily break one post's `meta` (for example set `date: "2026-02-31"`), run `yarn turbo run build --filter=./apps/website`, and confirm the build fails with the zod message rather than producing a broken page. Revert the change afterwards. This is the acceptance criterion that cannot be proven by a passing test alone, and the unit test in step 7 covers the same rule at the cheaper layer.

### 22. Run the validation commands

Run every command under **Validation Commands**, in order, and confirm each exits clean.

## Testing Strategy

### Unit Tests

`src/lib/blog/__tests__/schema.unit.test.ts` covers the whole frontmatter contract as pure input/output: valid meta parses, each invalid field shape throws (missing title, empty description, wrong date format, impossible date, non-kebab slug, hero without alt), ordering is newest first and non-mutating, and duplicate slugs throw a message that names the offender. It runs in the node pool and needs no DOM, which is why `schema.ts` deliberately imports no `.mdx` and no React rendering.

`posts.ts` itself is not unit-tested: it exists to import `.mdx` modules, and the vitest node pool has no MDX transform. Its behaviour is the composition of functions that are tested above, and its failure mode is a build failure, which step 21 exercises directly.

### Test Coverage

- `apps/website/src/lib/blog/__tests__/schema.unit.test.ts` (`*.unit.test.ts`) - catches a post shipping with a malformed or missing frontmatter field, and catches two posts claiming the same URL. Nothing today validates post metadata because no post metadata exists.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` (`*.browser.test.tsx`) - catches the room toggle failing to swap panels or failing to track `aria-selected`. Needs real DOM and a real click, so the node pool cannot prove it.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` (`apps/website/e2e/*.spec.ts`) - catches three things no cheaper layer can: that a reader can reach Stripe Checkout without leaving a post, that the index lists posts newest first as a rendered page, and that switching rooms issues no availability request. The last one is an assertion about network behaviour of a fully rendered route, which only the integration layer can observe.

No test is added for `sitemap.ts`, `robots.ts`, `next.config.ts` or the `knip.json` and prettier adjustments. The first two are static data generated from the same registry the tested schema produces, and asserting their output would restate the registry; the rest are configuration, validated by the build and by the gate commands themselves.

### Edge Cases

- A post whose `meta` is missing entirely, or is not an object. `toBlogPost` throws at module scope and the build fails.
- A date that parses as a string but is not a real day (`2026-02-31`). Rejected by the `.refine`, matching how `checkoutSchema` treats check-in and check-out.
- Two posts with the same `slug`. `assertUniqueSlugs` throws at build time instead of one post silently shadowing the other.
- A request for `/blog/does-not-exist`. `getPostBySlug` returns undefined and the route calls `notFound()`.
- An empty post list. `/blog` renders a short line rather than an empty page, and `sitemap.ts` still emits the static routes.
- A post with no `<BookingWidget />`. Renders normally; the second example post is exactly this case.
- Two widgets in one post. Both render; each mounts its own switcher state. Nothing in the design forbids it.
- `getAvailability` returning its non-fatal partial-failure `error`. The widget inherits `BookingClient`'s existing handling unchanged, because it is the same component.
- A booking completed elsewhere while a post page is cached. The post's engine reads through the same `availability-${room}` tag that the Stripe webhook and `api/bookings/direct` invalidate, so it refreshes with the booking page. No new cache code exists to get this wrong.
- A reader who picks dates for room 1 and then switches to room 2. The selection is intentionally dropped, because blocked dates differ per room.
- Mobile width. Both the index and the post read as a single column; the widget's tabs and the engine below it must not overflow at 375px.

## Acceptance Criteria

- `/blog` lists every post, newest first, and each entry links to its post.
- `/blog/<slug>` renders the post's MDX content with brand typography, and a post containing `<BookingWidget />` renders the widget inline between paragraphs, not as a link out to `/booking`.
- `yarn turbo run build --filter=./apps/website` reports `/blog` and every `/blog/<slug>` as statically generated, not dynamic. The relevant build-output lines are pasted into the pull request.
- A booking completes from inside a post: pick a room in the widget, choose dates, fill guest details, reach Stripe Checkout, the same destination as booking from `/booking/[type]`. Covered by the Playwright spec.
- Switching rooms inside the widget issues no availability request, verified in the browser network panel and asserted in the spec.
- A booking made elsewhere invalidates availability as seen from a post, because the post reads through the same `availability-${room}` cache tag. No second availability read path exists.
- A post with malformed frontmatter fails the build with a zod error rather than rendering broken.
- `getAvailability` still carries `"use cache"`, `cacheLife("minutes")` and both cache tags, unchanged. `BookingEngine`, `BookingClient`, `BookingPricing` and `submitBooking` are unchanged. `generateStaticParams` on `booking/[type]` still works and that page still renders as before.
- The post route contains no `cookies()`, `headers()`, `searchParams` read, or `export const dynamic`.
- `sitemap.ts` includes `/blog` and every post; `robots.ts` exists and points at the sitemap; each post has a title, description, canonical URL and Open Graph tags.
- The blog reads correctly at desktop and mobile widths, and looks like part of the site rather than bolted on.
- `yarn prettier --check .`, `yarn turbo run lint --filter=./apps/website`, `yarn turbo run typecheck --filter=./apps/website`, `yarn knip`, `yarn turbo run test --filter=./apps/website` and `yarn turbo run build --filter=./apps/website` all pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it (this is the gate the new `.mdx` file type has to clear, one way or the other).
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace.
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound, including the `.mdx` module imports resolved through `@types/mdx`.
- `yarn knip` - No unused files, exports or dependencies were introduced by the MDX packages or the new modules.
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the frontmatter contract and the room switcher with zero regressions.
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; read the route table and confirm `/blog` and `/blog/[slug]` are prerendered and that `/sitemap.xml` and `/robots.txt` are emitted.
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent && yarn turbo run typecheck --filter=./apps/telegram-router` - Nothing outside `apps/website` was touched; confirm the other workspaces are untouched and green.

The Playwright spec needs no entry here: the test phase runs `yarn workspace website test:integration` as its last step, so `e2e/blog-booking-flow.integration.spec.ts` is executed automatically.

## Notes

- **Deliberate deviation from the issue's suggested content path.** The issue suggests `apps/website/content/blog/*.mdx`. This plan uses `apps/website/src/content/blog/*.mdx` so posts resolve through the existing `@/*` alias with no new tsconfig path and no bundler configuration. Nothing else about the content design changes.
- **Deliberate deviation from the issue's frontmatter suggestion.** The issue suggests a frontmatter parser alongside `@next/mdx`. This plan uses `@next/mdx`'s own module-export frontmatter, documented in `node_modules/next/dist/docs/01-app/02-guides/mdx.md`, which removes the need for `gray-matter`, `remark-frontmatter` or `remark-mdx-frontmatter` entirely. It also sidesteps the Turbopack restriction that remark plugins must be passable by serialisable name. Frontmatter is still declarative, still lives in the post file, and is still validated by `zod` so a bad post fails the build, which is what the issue actually asks for.
- **Deliberate deviation from the `<Link>`-not-`<button>` tab rule.** `app_docs/nextjs-patterns-guide.md` says tab _navigation between pages_ uses `<Link>`. The room switcher navigates nowhere: it toggles which prerendered panel is on screen. Expressing it as a link or as URL state would mean reading `searchParams` in the post route, which the issue explicitly forbids and which would opt the page out of the static shell. `TabsDesktop`/`TabsMobile` are therefore not reused; `tab-styles.ts` keeps the two appearances from drifting.
- **`SITE_URL` versus `app_docs/dynamic-url-construction.md`.** That document's derive-from-request rule is scoped to API route handlers. `sitemap.ts`, `robots.ts` and a canonical URL cannot read the request without becoming dynamic, so a constant is the correct shape here. `SITE_URL` also replaces two existing hardcoded literals in `src/app/layout.tsx`, so the count of places the origin is written down goes down, not up.
- **Open question worth raising in the pull request, not silently resolving:** the brand is `issebya.homes` but `src/app/layout.tsx` has always used `https://issebya.com` for Open Graph URLs. This plan keeps `https://issebya.com` in `SITE_URL` to match the deployed behaviour. If the canonical domain is actually `issebya.homes`, changing one constant fixes the layout, the canonicals, the sitemap and robots together.
- **New dependencies:** `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react` (runtime) and `@types/mdx` (dev), all added with `yarn workspace website add`. Three of the four are config-only and will need `knip.json` `ignoreDependencies` entries.
- **Out of scope, per the issue:** a CMS, drafts, scheduled publishing, comments, search, tags, pagination, RSS, real editorial content beyond the two examples, and any change to booking or checkout logic.
- **Follow-ups this makes easy, once there are enough posts to justify them:** tags and pagination on the index, an RSS feed from the same registry, and `generateSitemaps` if the post count ever outgrows a single sitemap file. Each is a separate issue.
- **Documentation:** the `/document` phase owns writing the `app_docs` entry for this feature and adding its conditions to `docs/conditional-docs.md`. Two conditions are worth recording there when it does: "when adding a blog post" (add an import to `src/lib/blog/posts.ts`, it is not a filesystem scan) and "when embedding the booking engine anywhere outside `booking/[type]`" (reuse `BookingEngine` behind the `ErrorBoundary` + `Suspense` pair, never re-read availability).
