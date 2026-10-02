# Pin a blog post to the top of /blog

**ADW ID:** 423b11e9
**Date:** 2026-10-02
**Specification:** `specs/issue-212-adw-423b11e9-sdlc_planner-pin-blog-post-to-top.md`

## Overview

`/blog` listed posts strictly newest first, so the only way to keep a chosen
post at the top was to fake its date. A post can now opt in with
`pinned: true` in its `export const meta`: it sorts ahead of every unpinned
post and its card shows a small "Pinned" label. Pinning is a one-line content
edit resolved at build time, with no database, no admin UI and no request-time
read, so `/blog` stays in the static shell.

## What Was Built

- An optional boolean `pinned` on the post frontmatter contract
  (`postMetaSchema`), carried onto `BlogPost` via `z.infer`.
- One exported sorter, `sortPosts`, replacing `sortPostsByDateDesc`: pinned
  posts first, each group newest first, stable for equal keys.
- A "Pinned" label on the `/blog` card, above the date, in the date line's
  uppercase tracked style.
- Unit tests for the field and the ordering, and a new browser test for the
  card label.

## Technical Implementation

### Files Modified

- `apps/website/src/lib/blog/schema.ts`: `pinned: z.boolean().optional()` added
  after `hero`; `sortPostsByDateDesc` renamed to `sortPosts` with a
  pinned-then-date comparator and an updated doc comment.
- `apps/website/src/lib/blog/posts.ts`: `allPosts = sortPosts(posts)`.
- `apps/website/src/app/(main)/blog/ui/PostCard.tsx`: destructures `pinned`
  and renders `<p>Pinned</p>` as a sibling directly above the date `<p>`, same
  classes, only when `pinned` is true. Still a Server Component.
- `apps/website/src/lib/blog/__tests__/schema.unit.test.ts`: renamed
  `describe`, plus pinned parsing/rejection and ordering cases.
- `apps/website/src/app/(main)/blog/ui/PostCard.browser.test.tsx` (new): label
  present when pinned, absent when omitted or `false`.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`: the
  blog feature doc now describes `pinned` in the `meta` contract and the new
  sorter.

### Key Changes

- **Single comparator, no partition.** `Number(Boolean(b.pinned)) -
Number(Boolean(a.pinned)) || b.date.localeCompare(a.date)`. Stability comes
  from `Array.prototype.sort` (guaranteed since ES2019), so equal-key posts keep
  registry order without an index tiebreak.
- **Optional, not defaulted.** `toBlogPost(validMeta)` still returns exactly
  `{ ...validMeta, Content }` with no extra key, and existing posts need no
  edit. `pinned: false` behaves the same as omitting it.
- **Bad values fail the build.** `toBlogPost` already `parse`s at module
  evaluation, so `pinned: "yes"` (or `1`, `null`) throws and breaks the build
  like any other malformed field.
- **Rename, not add.** Keeping a single exported sorter avoids knip flagging an
  unused `sortPostsByDateDesc`.

## How to Use

1. In the post's `.mdx` under `apps/website/src/content/blog/`, add
   `pinned: true,` to `export const meta`.
2. Build or run the site: the post appears first on `/blog` with "Pinned" above
   its date.
3. To unpin, delete the line; the post drops back into date order.
4. If several posts are pinned, they sort newest first among themselves, all
   ahead of the unpinned posts.

## Configuration

None. No env vars, no new dependencies.

## Testing

- `yarn turbo run test --filter=./apps/website` runs both layers:
  - `schema.unit.test.ts` (node pool): `pinned: true` parses, `pinned: "yes"`
    throws, pinned-first ordering, per-group newest first, stability on equal
    dates in both groups, `pinned: false` as unpinned, no input mutation.
  - `PostCard.browser.test.tsx` (chromium): the label renders only for a
    pinned card. Mocks `next/link` and `next/image`, see
    `feature-437bcd03-blog-breadcrumb-trail.md` for why.
- `yarn turbo run build --filter=./apps/website` should still list `/blog` as
  static.
- Manual check: temporarily add `pinned: true` to
  `welcome-to-issebya-homes.mdx`, view `/blog`, then revert.

## Notes

- No e2e spec was added: no real post is pinned in this change, so a page-level
  spec would only see the unpinned state, already covered by the browser test.
- `/blog/[slug]` and `sitemap.ts` read `allPosts` but are order-insensitive.
- Out of scope: explicit order among pinned posts, a pinned section header, a
  different card layout. If explicit order is ever needed, replace the boolean
  with a numeric `pinOrder` compared before date in `sortPosts`; no call site
  changes.
