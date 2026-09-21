# Feature: Breadcrumb trail on blog post pages

## Metadata

issue_number: `93`
adw_id: `437bcd03`
issue_json: `{"number":93,"title":"Blog post pages need a breadcrumb trail back to /blog","body":"A blog post at /blog/[slug] renders an <article> with title, date, optional hero image and MDX content, and nothing that leads back to /blog. The only route back is the site header's Blog tab, a top-level nav item, not a 'you are here' trail. Opportunity: each post shows 'blog > <post title>' above the title, blog linking to /blog, the title the current non-linked item. Constraints: /blog/[slug] must stay prerendered (no usePathname, no request data, build the trail from post.title already in scope); semantic markup (<nav aria-label=\"Breadcrumb\"> wrapping an <ol>, current item aria-current=\"page\" and not a link); match the site type scale (text-xs text-gray-600, underline hover link, font-hand headings, no Radix); only the post page gets a breadcrumb, /blog shows none; do not change posts.ts, the MDX content, or mdx-components.tsx. Verification: extend apps/website/e2e/blog-booking-flow.integration.spec.ts; negative check on /blog; yarn build still lists /blog/[slug] as prerendered; lint/typecheck/test/knip green. Out of scope: booking-from-a-post return path, breadcrumbs on /booking/* or /contact, BreadcrumbList JSON-LD, header nav changes."}`

## Feature Description

Every blog post page (`/blog/[slug]`) gains a breadcrumb trail rendered directly
above the post title: `blog › <post title>`, where `blog` is a link back to the
blog index and the post title is the current, non-linked item.

The trail is a Server Component built from data already in scope on the page
(`post.title`), so the route stays in the static shell. It is semantic markup
(`<nav aria-label="Breadcrumb">` wrapping an `<ol>`, with `aria-current="page"`
on the current item and an `aria-hidden` separator), so assistive tech announces
it as a breadcrumb rather than as a decorative line of text. It uses the site's
existing type scale (`text-xs text-gray-600`, underlined link) so it reads as
part of the page, not as a UI-kit import.

Value: a reader who arrived from a shared link, or who scrolled past the inline
booking widget to the end of a long post, has an in-page route back to the list
of posts instead of having to find the top-level Blog tab in the site header.

## User Story

As a reader who landed on a single blog post from a shared link
I want a breadcrumb trail above the post title that links back to the blog index
So that I can get to the rest of the posts without hunting through the site header, and so a screen reader announces where in the site I am

## Problem Statement

`apps/website/src/app/(main)/blog/[slug]/page.tsx` renders an `<article>`
containing an `<h1>`, the formatted date, an optional hero `<Image>` and the MDX
`<Content />`. Nothing in that subtree links to `/blog`. The only path back is
`Link href="/blog"` in `src/app/ui/Header.tsx`, which is a top-level nav tab
signalling a section, not a position within it.

Two concrete consequences:

- A reader arriving cold on a post has no in-context signal that a blog index
  exists, or that the post belongs to it.
- Posts are long and carry an inline `<BookingWidget />`; by the end of a post
  the header is far off-screen and there is no nearby route onward.

There is no breadcrumb component anywhere in `apps/website/src` today (the only
`Breadcrumb` matches are Sentry's `addBookingBreadcrumb`, unrelated), so this is
net-new UI rather than an application of an existing pattern.

## Solution Statement

Add one small Server Component, `Breadcrumb`, under
`src/app/(main)/blog/ui/` (alongside the existing `BookingWidget` and
`RoomSwitcher`), taking the current post's title as its only prop and rendering:

```tsx
<nav aria-label="Breadcrumb">
  <ol>
    <li>
      <Link href="/blog">blog</Link>
    </li>
    <li aria-current="page">
      <span aria-hidden="true">›</span>
      {title}
    </li>
  </ol>
</nav>
```

Render it in `blog/[slug]/page.tsx` as the first child of the `<article>`,
immediately above the `<h1>`.

Why this shape:

- **No client code, no request data.** The component has no `"use client"`, no
  hooks, no `usePathname()`, no `searchParams`/`cookies()`/`headers()`. The only
  input is the `title` the page already destructures off `getPostBySlug(slug)`,
  so `/blog/[slug]` keeps prerendering under `cacheComponents` exactly as the
  comment block in `page.tsx` records.
- **Two list items, not three.** The `›` separator lives inside the current-page
  `<li>` as an `aria-hidden` span, so the `<ol>` has exactly two entries in the
  accessibility tree and the separator never lands in the current item's
  accessible name.
- **Existing type scale.** `text-xs text-gray-600` for the trail (the same
  treatment as the post's date line directly below it) and `underline` on the
  link, matching `mdx-components.tsx`'s anchor treatment. No new tokens, no
  Radix (not installed, per `apps/website/AGENTS.md`).
- **Post page only.** `/blog` is the root of the trail and renders none, which
  is also what the negative E2E assertion pins.

`posts.ts`, the MDX content files and `mdx-components.tsx` are untouched: this is
page layout, not content.

## Relevant Files

Use these files to implement the feature:

- `apps/website/src/app/(main)/blog/[slug]/page.tsx` — the post page. The only
  file that changes behaviour: import `Breadcrumb` and render it above the
  `<h1>`. Its comment block records the prerendering contract that must survive;
  do not add `export const dynamic`, `searchParams`, `cookies()` or `headers()`.
- `apps/website/src/app/(main)/blog/page.tsx` — the index. Read-only reference
  for the `font-hand` lowercase `blog` heading and `text-xs text-gray-600`
  metadata treatment; it must keep rendering no breadcrumb.
- `apps/website/src/mdx-components.tsx` — read-only reference for the site's
  link treatment (`underline hover:text-gray-600`). Explicitly out of bounds for
  edits per the issue.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` — reference for how a
  blog-local Server Component in `blog/ui/` is written and documented (named
  export, file-level JSDoc explaining the non-obvious decisions).
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` — reference
  for the browser-test layer's conventions (`vitest/browser` + `vitest-browser-react`,
  `render(...)`, `page.getByRole(...)`).
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` — the spec to extend.
  It already navigates to `/blog` and to `/blog/a-weekend-in-almocageme`, so both
  the positive and negative assertions have a home here.
- `apps/website/src/lib/blog/posts.ts` — read-only: confirms `title` and `slug`
  are plain fields on the `BlogPost` the page already has. Must not change.
- `apps/website/src/app/ui/Header.tsx` — read-only: the site header is also a
  `<nav>`, but an unnamed one, which is why the negative assertion filters on the
  accessible name `"Breadcrumb"` and can still expect count 0 on `/blog`.
- `apps/website/AGENTS.md` — workspace rules: Server Components by default, no
  Radix, `next/image` for images, read the Next.js docs in `node_modules/next/dist/docs/`
  before Next.js work.
- `apps/website/app_docs/nextjs-patterns-guide.md` — matched condition: "adding or
  changing a route, layout, Server Component"; "deciding between server and client
  rendering".
- `apps/website/app_docs/component-patterns-guide.md` — matched condition:
  "creating a component".
- `apps/website/app_docs/testing/component_test_spec_format.md` — matched
  condition: writing a component (browser) test.
- `apps/website/app_docs/testing/e2e_example.md` — matched condition: adding to a
  Playwright spec under `apps/website/e2e/`.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` — matched
  condition: "when a blog route stops prerendering". Records why `/blog/[slug]`
  is in the static shell and what breaks it.
- `apps/website/vitest.config.ts` — read-only: confirms the browser project picks
  up `src/app/**/*.browser.test.tsx` automatically, so a new test file in
  `blog/ui/` needs no config change.
- `knip.json` — read-only: `apps/website` counts `src/**/*.tsx` as project files
  with `*.browser.test.tsx` as entries, so the new component must be imported by
  the page (it is) and the new test file is an entry point. No config change
  expected.

### New Files

- `apps/website/src/app/(main)/blog/ui/Breadcrumb.tsx` — the trail. Named export
  `Breadcrumb`, one prop (`title: string`), Server Component, file-level JSDoc
  recording why it takes the title as a prop rather than reading the path.
- `apps/website/src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx` — component
  test for the accessibility semantics (named navigation landmark, the `blog`
  link's `href`, the current item carrying `aria-current="page"` and not being a
  link, the separator not polluting the accessible name).

## Implementation Plan

### Phase 1: Foundation

Read the matched documentation (`apps/website/AGENTS.md`, the Next.js patterns
and component patterns guides, the two testing spec formats, and the
blog-with-booking-widget feature doc for the prerendering contract). Confirm from
`blog/[slug]/page.tsx` that `title` is already destructured off the post, and
from `vitest.config.ts` that `src/app/**/*.browser.test.tsx` is in the browser
project's include list.

### Phase 2: Core Implementation

Create `Breadcrumb.tsx` in `blog/ui/` as a props-only Server Component with the
semantic markup and the site's type scale, then write its browser test asserting
the accessibility semantics rather than the class names.

### Phase 3: Integration

Render `<Breadcrumb title={title} />` as the first child of the `<article>` in
`blog/[slug]/page.tsx`, above the `<h1>`. Extend the existing blog Playwright
spec with a post-page assertion (trail present, link works, current item marked)
and a `/blog` negative assertion. Confirm with a production build that
`/blog/[slug]` is still listed as a prerendered route, then run the full
validation set.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the documentation that applies

- Read `apps/website/AGENTS.md` (always, for any change under `apps/website/`).
- Read `apps/website/app_docs/nextjs-patterns-guide.md` and
  `apps/website/app_docs/component-patterns-guide.md`.
- Read `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` for
  the blog routes' static-shell contract.
- Read `apps/website/app_docs/testing/component_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md`.
- Read the relevant Next.js doc under `node_modules/next/dist/docs/` for Server
  Components / linking, per the workspace rule that training data is not the
  source of truth.

### 2. Create the `Breadcrumb` Server Component

- New file `apps/website/src/app/(main)/blog/ui/Breadcrumb.tsx`.
- Named export `export function Breadcrumb({ title }: { title: string })`. No
  `"use client"`, no hooks, no default export (the neighbouring `BookingWidget`
  and `RoomSwitcher` are named exports).
- Markup:
  - `<nav aria-label="Breadcrumb" className="mb-2">`
  - `<ol className="flex flex-wrap items-center text-xs text-gray-600">`
  - First `<li>`: `<Link href="/blog" className="underline hover:text-black">blog</Link>`
    (`Link` imported from `next/link`, destructured-default import, matching
    `blog/page.tsx`). Label is lowercase `blog`, matching the index's own
    lowercase `font-hand` heading.
  - Second `<li aria-current="page">` containing
    `<span aria-hidden="true" className="mx-2">›</span>` followed by `{title}`.
    The separator is inside the current item and `aria-hidden`, so the `<ol>`
    exposes exactly two items and the separator is not part of the current
    item's accessible name.
- Add a short file-level JSDoc recording the two non-obvious decisions: the title
  arrives as a prop (not from `usePathname()`) so the route stays prerendered,
  and the separator is decoration inside the current `<li>` rather than a third
  list item.
- Do not add a `slug` prop: only the title is rendered, and passing an unused
  prop would trip knip/lint.

### 3. Render the trail on the post page

- Edit `apps/website/src/app/(main)/blog/[slug]/page.tsx`.
- Add `import { Breadcrumb } from "../ui/Breadcrumb";` alongside the existing
  imports (match the file's existing relative/alias import style; `BookingWidget`
  is imported elsewhere via `@/app/(main)/blog/ui/...`, so either form is
  consistent as long as ESLint's import ordering is satisfied).
- Render `<Breadcrumb title={title} />` as the first child of the `<article>`,
  directly above the `<h1>`.
- Change nothing else: no `export const dynamic`, no `searchParams`, no
  `cookies()`/`headers()`, no new imports that read the request. The existing
  comment block above the component explains why; leave it intact.

### 4. Add the component browser test

- New file `apps/website/src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx`
  (picked up automatically by the `browser` project's
  `src/app/**/*.browser.test.tsx` include).
- Use `render` from `vitest-browser-react` and `page` from `vitest/browser`, as
  `RoomSwitcher.browser.test.tsx` does.
- Assertions:
  - `page.getByRole("navigation", { name: "Breadcrumb" })` is in the document.
  - `page.getByRole("link", { name: "blog" })` has `href="/blog"`.
  - The current item is present with `aria-current="page"` and is **not** a link:
    `page.getByRole("link", { name: <post title> })` resolves to zero elements.
  - The current item's accessible name is the title alone, i.e. it does not
    include the `›` separator.
- If `next/link` misbehaves under vitest browser mode (it is rendered outside a
  Next router), mock it at the top of the file with
  `vi.mock("next/link", () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }))`.
  The assertions are about roles, names and `href`, not about Next's client-side
  navigation, so the mock costs the test nothing. Prefer the unmocked version if
  it passes.

### 5. Extend the Playwright spec

- Edit `apps/website/e2e/blog-booking-flow.integration.spec.ts` (do not create a
  new spec file: this one already opens both `/blog` and `WIDGET_POST`, and
  `playwright.config.ts` runs with `workers: 1` partly to keep blog/booking
  fixture collisions away — adding a file increases run time for no gain).
- Add one test, `"a post links back to the index through a breadcrumb trail"`:
  - `await page.goto(WIDGET_POST);`
  - `const trail = page.getByRole("navigation", { name: "Breadcrumb" });`
    expect it to be visible.
  - `await expect(trail.getByRole("link", { name: "blog" })).toHaveAttribute("href", "/blog");`
  - `await expect(trail.getByText(NEWER_POST_TITLE)).toHaveAttribute("aria-current", "page");`
    (the post title as the current, non-linked item).
  - Click the `blog` link, `await page.waitForURL("**/blog")`, and assert both
    post headings (`NEWER_POST_TITLE`, `OLDER_POST_TITLE`) are visible — the same
    two constants the index test already uses.
- Add one negative test, `"the index shows no breadcrumb"`:
  - `await page.goto("/blog");`
  - `await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);`
    This also proves the site header's unnamed `<nav>` is not being matched.
- Keep both tests inside the existing `test.describe("Blog with an inline booking widget", ...)`
  block, or add a sibling `test.describe("Blog breadcrumb trail", ...)` in the
  same file; either is fine, pick whichever reads better next to the existing
  tests. Do not touch the existing three tests.
- Do not add an agent-driven `e2e/*.md` journey: this behaviour is fully
  deterministic and provable by a Playwright spec, which is this project's
  default.

### 6. Verify the static shell is preserved

- Run `yarn turbo run build --filter=./apps/website`.
- In the route table of the build output, confirm `/blog/[slug]` is still marked
  as a prerendered/static route (with its two generated slugs listed) and **not**
  as a dynamic `ƒ` route. Quote those lines in the implementation report.
- If it flipped to dynamic, the cause is something introduced in step 2 or 3
  reading request data; fix it there rather than adding a config flag.

### 7. Run the validation commands

- Run every command in `Validation Commands` below, from the repository root
  unless stated otherwise, and confirm each exits clean.

## Testing Strategy

### Unit Tests

No `*.unit.test.ts` is warranted. There is no pure logic in this feature: the
component is a props-to-JSX mapping with no branching, no formatting and no data
transformation. A node-pool test could only restate the JSX, which is exactly the
kind of noise the plan format warns against. The behaviour that actually matters
(is this a breadcrumb to assistive tech, and does the link go to `/blog`) is a
DOM/accessibility-tree property, so it is proved one layer up in the browser
test.

### Test Coverage

- `apps/website/src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx`
  (**browser** layer) — catches the accessibility contract that nothing else
  checks: that the landmark is a `navigation` named `Breadcrumb`, that the `blog`
  item is a link to `/blog`, that the current item carries `aria-current="page"`
  and is **not** a link, and that the `›` separator stays out of the accessible
  name. A regression that swaps the `<ol>` for `<div>`s, drops the `aria-label`,
  or turns the current item into a link would pass a snapshot and fail here.
  Fails today: the component does not exist.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` → "a post links back
  to the index through a breadcrumb trail" (**e2e** layer) — catches the
  integration the browser test cannot see: that the trail is actually rendered by
  the real `/blog/[slug]` route with the real post's title, and that clicking it
  lands on `/blog` with the post list rendered. Fails today: no `navigation`
  named `Breadcrumb` exists on the post page.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` → "the index shows no
  breadcrumb" (**e2e** layer) — pins the "post page only" constraint and proves
  the assertion's selector is specific enough not to match the site header's
  unnamed `<nav>`. Would fail if someone later lifted the trail into the blog
  layout.
- Build check (not a test layer, but part of verification) — `yarn build` output
  must still list `/blog/[slug]` as prerendered. No automated assertion exists
  for this in the repo; it is a manual read of the route table, as step 6 says.

### Edge Cases

- **Long post titles.** `A weekend in Almoçageme` and `House notes: the shared
kitchen` both wrap on narrow viewports; `flex flex-wrap` on the `<ol>` keeps
  the trail from overflowing horizontally rather than pushing the article wide.
- **Non-ASCII titles.** `Almoçageme` contains a cedilla; the title is rendered as
  text with no slug-ification or escaping, and the E2E assertion uses the same
  `NEWER_POST_TITLE` constant the existing tests use, so the encoding path is
  already exercised.
- **Unknown slug.** `notFound()` fires before any rendering, so a 404 page has no
  breadcrumb. No extra handling needed; do not move the breadcrumb above the
  `notFound()` guard.
- **Screen-reader announcement of the separator.** Covered by the `aria-hidden`
  span assertion in the browser test; a `›` read aloud as "single right-pointing
  angle quotation mark" is exactly the failure this guards.
- **Header nav collision.** Both the header and the trail are `<nav>` landmarks.
  The trail is the only named one, which is what makes the negative assertion
  meaningful; if the header ever gains `aria-label="Breadcrumb"` the negative
  test fails loudly, which is correct.
- **Hover contrast.** The trail is `text-gray-600`, so `hover:text-gray-600`
  (the treatment used elsewhere for darker text) would be a no-op. The link uses
  `hover:text-black` so the hover state is actually visible. See `Notes`.

## Acceptance Criteria

- `/blog/a-weekend-in-almocageme` and `/blog/house-notes-the-shared-kitchen`
  each render, directly above the `<h1>`, a `<nav aria-label="Breadcrumb">`
  containing an `<ol>` with exactly two items.
- Item one is a link reading `blog` with `href="/blog"`; clicking it lands on the
  blog index with both post headings visible.
- Item two is the current post's title, carries `aria-current="page"`, and is not
  a link.
- The `›` separator is `aria-hidden="true"` and does not appear in the current
  item's accessible name.
- `/blog` renders no element matching `getByRole("navigation", { name: "Breadcrumb" })`.
- The trail uses `text-xs text-gray-600` and an underlined link; no new colour or
  type tokens, no Radix, no client component, no new dependency.
- `apps/website/src/lib/blog/posts.ts`, `src/mdx-components.tsx` and every file
  under `src/content/blog/` are unchanged.
- `yarn build` for `apps/website` still lists `/blog/[slug]` as a prerendered
  route, and the relevant lines are quoted in the implementation report.
- `yarn prettier --check .`, lint, typecheck, unit tests, knip, the Playwright
  suite and the production build all pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace (including `jsx-a11y` on the new markup)
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (the new component must be imported by the post page; the new `*.browser.test.tsx` is a declared entry)
- `yarn turbo run test --filter=./apps/website` - Unit tests pass, proving zero regressions
- `yarn workspace website test:browser --run` - The new `Breadcrumb.browser.test.tsx` passes in chromium, firefox and webkit (the `test` script above runs only the `unit` project, so the browser project needs its own invocation here)
- `yarn turbo run build --filter=./apps/website` - Production build succeeds **and** `/blog/[slug]` is still listed as a prerendered (static) route, not `ƒ`

## Notes

- **No new dependency.** `next/link` and Tailwind classes already in use are
  everything this needs. Nothing to `yarn workspace website add`.
- **Hover colour is a deliberate deviation.** The issue quotes the site's link
  treatment as `underline hover:text-gray-600`, but the trail's resting colour is
  already `text-gray-600`, so that hover would be invisible. The plan uses
  `underline hover:text-black` — same idea (hover changes the text colour),
  inverted because the baseline is grey. If the reviewer prefers literal
  consistency over a visible hover, swapping to `hover:text-gray-600` is a
  one-word change and no test depends on the class.
- **Separator character.** `›` (U+203A) is used rather than `/`, matching the
  issue's first suggestion and reading as a trail rather than a path. It is
  decoration only.
- **Why `blog` and not `Blog`.** The index's own `<h1>` is lowercase `blog` in
  `font-hand`; the trail's first item repeats that word, so lowercase keeps it
  consistent with the page it points at. The header nav's `Blog` tab is a
  different surface and is out of scope.
- **Deliberately not done here** (all called out as out of scope in the issue):
  `BreadcrumbList` JSON-LD structured data, breadcrumbs on `/booking/*` or
  `/contact`, the booking-from-a-post return path, and any header change. The
  component is written so JSON-LD could be added later beside it without
  restructuring, but this plan adds none.
- **Prerendering is the one thing that can quietly break.** Everything else here
  fails loudly. `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`
  already documents the "a blog route stopped prerendering" condition; if step 6
  shows `/blog/[slug]` as dynamic, read that doc before reaching for a config
  flag.
- **Documentation.** The pipeline's `/document` stage owns appending an entry to
  `docs/conditional-docs.md` and any new `app_docs` file. This plan does not
  write documentation itself.
