# Forest bathing blog post

**ADW ID:** bf15ab13
**Date:** 2026-10-03
**Specification:** `specs/issue-217-adw-bf15ab13-sdlc_planner-forest-bathing-blog-post.md`

## Overview

`/blog` had a single post, and nothing on the site explained the forest walks
that are part of a stay. This adds a second post, "Forest bathing: a slow walk
in the Sintra woods", a short calm note on shinrin-yoku tied to the forest a
few minutes up the road. It is a pure content addition through the existing
MDX pipeline: no schema, route or component changes.

## What Was Built

- A new MDX post, `forest-bathing.mdx`, with a `meta` block and a five-sentence
  body (verbatim from issue #217) in two paragraphs. No headings, links,
  booking widget or call to action.
- Registration of the post in the explicit blog registry, which is what makes
  `/blog`, `/blog/forest-bathing`, `generateStaticParams` and the sitemap
  pick it up.
- Two new Playwright tests: index ordering (new post first, then the welcome
  post) and the post page rendering its title, hero and body.

## Technical Implementation

### Files Modified

- `apps/website/src/content/blog/forest-bathing.mdx`: new post. `date`
  `2026-10-03`, `slug` `forest-bathing`, `description` 139 characters, hero
  reuses `/frontyard.webp` (1920x1280).
- `apps/website/src/lib/blog/posts.ts`: imports the post and adds a
  `toBlogPost(forestBathingMeta, ForestBathing)` entry.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`: adds
  `FOREST_POST`/`FOREST_TITLE`, replaces the stale "single post" comment, and
  adds the ordering and rendering tests.

### Key Changes

- Ordering comes from `sortPosts` (pinned first, then newest first), not from
  registry order. Neither post is pinned, so the 2026-10-03 post sorts ahead
  of the 2026-09-21 welcome post.
- The hero reuses an existing image instead of adding a binary. `frontyard.webp`
  is the only photo in `public/` where greenery is the subject; its alt text
  describes the front yard honestly and does not claim it shows the forest.
- `meta` is validated at module scope by `toBlogPost`, so a malformed post
  fails `next build`; the build is the CI-gated proof the post is valid.
- The ordering test scopes to the `Posts` region's list items, so it asserts
  against the real registry rather than the unit-tested sorter alone.

## How to Use

1. Visit `/blog`: the forest bathing card is first, with its description,
   followed by the welcome post.
2. Open `/blog/forest-bathing` to read the post.
3. To add further posts, follow the "How to Use" section of
   `feature-fe1ca663-blog-with-booking-widget.md`: create the `.mdx`, then
   import and register it in `posts.ts`. An unregistered post does not exist.

## Configuration

None. No new dependencies, environment variables or images.

## Testing

- `yarn turbo run build --filter=./apps/website` validates the `meta` and
  prerenders `/blog/forest-bathing`.
- `yarn workspace website test:integration` runs the extended Playwright spec
  (run by the ADW test phase, not CI).
- No unit test was added: `posts.ts` imports `.mdx`, which the vitest node pool
  cannot transform, and the schema and sorter are already covered by
  `src/lib/blog/__tests__/schema.unit.test.ts`.

## Notes

- The Playwright ordering test hard-codes this post as first. Publishing a
  newer post, or pinning the welcome post, will break
  "index lists the forest bathing post first" and needs that test updated.
- `prettier --write` must leave the `meta` block unchanged; the body is
  hand-wrapped and kept as written (`proseWrap: "preserve"`).
