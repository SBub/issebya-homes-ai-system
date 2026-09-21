# Blog post breadcrumb trail

**ADW ID:** 437bcd03
**Date:** 2026-09-21
**Specification:** `specs/issue-93-adw-437bcd03-sdlc_planner-blog-breadcrumb-trail.md`

## Overview

A blog post at `/blog/[slug]` rendered a title, a date, an optional hero image
and its MDX content, with nothing in that subtree leading back to `/blog`. The
only route back was the site header's Blog tab, a top-level nav item rather than
a "you are here" trail. Every post now renders `blog › <post title>` directly
above its `<h1>`, with `blog` linking to the index and the post title as the
current, non-linked item.

## What Was Built

- `Breadcrumb`, a props-only Server Component under `blog/ui/`, rendering a
  named `<nav>` landmark around a two-item `<ol>`.
- The trail rendered as the first child of the `<article>` on `/blog/[slug]`.
- Five browser tests pinning the accessibility contract (landmark name, link
  target, item count, `aria-current`, hidden separator).
- Two Playwright tests: the trail works end to end on a real post, and `/blog`
  renders no breadcrumb at all.

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/blog/ui/Breadcrumb.tsx` (new): the component.
  Named export, one prop (`title: string`), no `"use client"`, no hooks. A
  file-level JSDoc records the two non-obvious decisions (title as a prop, and
  the separator living inside the current item).
- `apps/website/src/app/(main)/blog/[slug]/page.tsx`: imports `Breadcrumb` and
  renders `<Breadcrumb title={title} />` above the `<h1>`. Nothing else in the
  file changed, and the comment block recording the prerendering contract is
  intact.
- `apps/website/src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx` (new): the
  accessibility tests, with a `next/link` module mock.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`: a new
  `test.describe("Blog breadcrumb trail", ...)` block with the positive and the
  negative test. The existing tests are untouched.

### Key Changes

- **The title arrives as a prop, never from the URL.** `usePathname()` would
  make the component a Client Component and pull request data into the route,
  which is the one thing that would quietly knock `/blog/[slug]` out of the
  static shell. The page already has `title` in scope from
  `getPostBySlug(slug)`, so the trail costs the route nothing.
- **Two list items, not three.** The `›` separator is an `aria-hidden` span
  inside the current-page `<li>` rather than its own list item, so the `<ol>`
  exposes exactly two entries and the separator never joins the current item's
  accessible name. Without that, a screen reader reads the title as "single
  right-pointing angle quotation mark, A weekend in Almoçageme".
- **The current item is text, not a link.** `<li aria-current="page">` holds
  the bare title, so there is no self-referential link for a keyboard user to
  tab through.
- **Existing type scale only.** `text-xs text-gray-600` on the `<ol>` (the same
  treatment as the date line directly below) and `underline` on the link. No
  new token, no Radix, no dependency.
- **Post page only.** `/blog` is the root of the trail and renders none, which
  the negative E2E test pins. That test also proves the selector is specific
  enough: the site header is a `<nav>` too, but an unnamed one, so filtering on
  the accessible name `"Breadcrumb"` keeps it at zero.
- **`next/link` is mocked in the browser test.** The real module reaches for
  `process` at import time (via `resolve-href` to `is-local-url` to
  `has-base-path`), which does not exist in browser mode and fails the suite in
  firefox. The assertions are about roles, names and `href`, so a plain `<a>`
  stands in without weakening anything.

## How to Use

1. Run the site: `cd apps/website && yarn dev` (the app honours `PORT` and only
   defaults to 3000).
2. Open `http://localhost:<PORT>/blog/a-weekend-in-almocageme`.
3. The line `blog › A weekend in Almoçageme` sits directly above the post
   title. Click `blog` to land on the index.
4. `/blog` itself shows no trail: it is the root.

## Configuration

None. No new dependency, no environment variable, no route config, no change to
`posts.ts`, the MDX content or `mdx-components.tsx`.

## Testing

- `yarn workspace website test:browser --run` runs
  `Breadcrumb.browser.test.tsx` in chromium, firefox and webkit. Note that
  `yarn turbo run test --filter=./apps/website` runs only the `unit` project, so
  the browser project needs this separate invocation.
- `yarn workspace website test:integration` runs the Playwright suite,
  including the two new breadcrumb tests.
- `yarn turbo run build --filter=./apps/website` must still list `/blog/[slug]`
  as a prerendered route with both slugs generated, not as a dynamic `ƒ` route.
  There is no automated assertion for this; it is a read of the route table.

## Notes

- The change is confined to `apps/website`.
- No unit test was added. The component is a props-to-JSX mapping with no
  branching or formatting, so a node-pool test could only restate the JSX. What
  actually matters (is this a breadcrumb to assistive tech) is an
  accessibility-tree property, proved in the browser layer instead.
- **Hover colour is a deliberate deviation.** The site's link treatment
  elsewhere is `underline hover:text-gray-600`, but the trail's resting colour
  is already `text-gray-600`, so that hover would be invisible. The link uses
  `hover:text-black` instead. No test depends on the class.
- An unknown slug hits `notFound()` before any rendering, so a 404 page has no
  breadcrumb. Do not move the trail above that guard.
- Out of scope and deliberately not built: `BreadcrumbList` JSON-LD structured
  data, breadcrumbs on `/booking/*` or `/contact`, a booking-from-a-post return
  path, and any header nav change. The component is shaped so JSON-LD could be
  added beside it later without restructuring.
