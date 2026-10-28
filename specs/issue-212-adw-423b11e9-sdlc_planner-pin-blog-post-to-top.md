# Feature: Pin a blog post to the top of /blog

## Metadata

issue_number: `212`
adw_id: `423b11e9`
issue_json: `{"number":212,"title":"website: pin a blog post so it stays at the top of /blog"}`

## Feature Description

`/blog` lists posts newest first. The owner wants to keep a chosen post at the top of that list regardless of its date. A post opts in by adding `pinned: true` to its `export const meta` in its `.mdx` file. A pinned post sorts ahead of every unpinned post and its card on `/blog` carries a small "Pinned" label in the same uppercase tracked style as the date line. Removing the flag drops the post back into date order. There is no database, no admin UI and no request-time read: pinning is a one-line content edit, like every other post attribute, and is resolved at build time.

## User Story

As the site owner
I want to mark a blog post as pinned in its file
So that guests see the post I care most about first on `/blog`, even after newer posts are published

## Problem Statement

The blog registry sorts strictly by date, so the only way to keep a post at the top today is to fake its date, which also changes the date shown on the card and in the post. There is no way to express "this post matters most" independently of when it was written.

## Solution Statement

Extend the `zod` frontmatter contract (`postMetaSchema`) with an optional boolean `pinned`. Replace `sortPostsByDateDesc` with a single exported sorter `sortPosts` that puts pinned posts first, each group newest first, stable for equal keys, returning a new array. `allPosts` in `posts.ts` uses it, so `/blog`, `/blog/[slug]` and `sitemap.ts` all keep reading from the same list (only `/blog` cares about order). `PostCard` renders a "Pinned" label above the date, in the date line's existing classes, only when `post.pinned` is true. Everything is resolved at module scope from imports, so `/blog` stays in the static shell. A malformed value (e.g. `pinned: "yes"`) fails `postMetaSchema.parse` in `toBlogPost` and therefore fails the build, exactly like any other bad field.

Design decisions:

- **Rename, don't add.** The issue asks to keep one exported sorter. Renaming `sortPostsByDateDesc` to `sortPosts` (instead of adding a second function) also keeps knip clean: a now-unused `sortPostsByDateDesc` export would be flagged.
- **Single comparator, no partition.** `Array.prototype.sort` is guaranteed stable since ES2019, so a comparator that compares `pinned` first (`Number(!!b.pinned) - Number(!!a.pinned)`) and falls back to `b.date.localeCompare(a.date)` gives pinned-first, newest-first-per-group and stability for equal dates in one pass. Keep the existing "no `Date` constructed, `yyyy-MM-dd` is lexicographic" comment.
- **`pinned` stays optional, not defaulted.** `z.boolean().optional()` means `toBlogPost(validMeta)` still returns exactly `{ ...validMeta, Content }` with no extra key, so the existing `toEqual` test is untouched and existing posts need no edit.
- **Label is a sibling `<p>`, not part of the date text.** It sits immediately above the date `<p>` with the same `uppercase tracking-[0.2em] text-[10px]` classes, no new colour tokens. A separate element keeps the date's text exactly as it is and makes the label independently assertable.

## Relevant Files

Use these files to implement the feature:

- `README.md` - repository overview (read first).
- `AGENTS.md` - repo-wide conventions: yarn only, conventional commits, lefthook, doc convention.
- `apps/website/AGENTS.md` - website rules: calendar days are strings (never `Date`), which test layers gate (unit + browser gate on push/CI, `e2e/` does not).
- `docs/conditional-docs.md` - doc index; the matching entries are listed below.
- `apps/website/src/lib/blog/schema.ts` - `postMetaSchema`, `BlogPost`, `toBlogPost`, `sortPostsByDateDesc`, `assertUniqueSlugs`. Gains the `pinned` field and the renamed `sortPosts`.
- `apps/website/src/lib/blog/posts.ts` - registry; `allPosts = sortPostsByDateDesc(posts)` switches to `sortPosts`. `getPostBySlug` unchanged.
- `apps/website/src/lib/blog/__tests__/schema.unit.test.ts` - node-pool suite for the schema and sorter; extended with the pinned cases and the renamed `describe`.
- `apps/website/src/app/(main)/blog/ui/PostCard.tsx` - card on `/blog`; gains the conditional "Pinned" label.
- `apps/website/src/app/(main)/blog/page.tsx` - renders `allPosts` as `PostCard`s; read-only check that it still reads nothing from the request. No edit expected.
- `apps/website/src/app/sitemap.ts` - consumes `allPosts`; unaffected, verify nothing imports `sortPostsByDateDesc` there (grep).
- `apps/website/src/content/blog/welcome-to-issebya-homes.mdx` - the only post. Must NOT be pinned in the commit; only touched temporarily during manual verification and reverted.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx` - the pattern for the new browser test: `vi.mock("next/link")` and `vi.mock("next/image")` stand-ins before importing the component.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` - existing blog Playwright spec; its comment at line ~20 already states ordering is covered "one layer down" (the unit suite). Not changed.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` - documents the post `meta` contract in "How to Use" and the sorter in "Files Modified" / "Testing"; gains `pinned`.
- `apps/website/app_docs/zod-validation-guide.md` - conditional doc: adding a field to an existing schema.
- `apps/website/app_docs/component-patterns-guide.md` - conditional doc: changing a component.
- `apps/website/app_docs/feature-437bcd03-blog-breadcrumb-trail.md` - conditional doc: why `next/link` is mocked in `*.browser.test.tsx` (`process is not defined`).
- `apps/website/app_docs/testing/component_test_spec_format.md` and `apps/website/app_docs/testing/unit_test_spec_format.md` - conditional docs for the two test layers used.
- `apps/website/app_docs/nextjs-patterns-guide.md` - conditional doc: keeping a Server Component route in the static shell.

### New Files

- `apps/website/src/app/(main)/blog/ui/PostCard.browser.test.tsx` - browser test asserting the "Pinned" label renders when `pinned: true` and is absent when `pinned` is false or omitted.

## Implementation Plan

### Phase 1: Foundation

Extend `postMetaSchema` with `pinned: z.boolean().optional()` (with a one-line comment in the file's voice explaining it lifts the post above date order on `/blog`). `BlogPost` picks it up automatically via `z.infer`. Rename `sortPostsByDateDesc` to `sortPosts` and change its comparator to pinned-first, then date-desc, updating its doc comment to describe both keys and stability.

### Phase 2: Core Implementation

Unit tests for the schema field and the sorter. Then `PostCard` gains the label and its browser test.

### Phase 3: Integration

`posts.ts` switches to `sortPosts`. The app doc gains the `pinned` field in its `meta` example and its descriptions of `schema.ts`, the index ordering and the unit tests. Manual verification on a local build with the welcome post temporarily pinned, then revert.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/zod-validation-guide.md`, `apps/website/app_docs/component-patterns-guide.md`, and the `next/link` mock note in `apps/website/app_docs/feature-437bcd03-blog-breadcrumb-trail.md`.
- Per `apps/website/AGENTS.md`, skim the relevant Next.js doc in `node_modules/next/dist/docs/` on static rendering before touching the route.

### 2. Add `pinned` to the schema

- In `apps/website/src/lib/blog/schema.ts`, add to `postMetaSchema` after `hero`:
  - a short comment (e.g. "Lifts the post above date order on `/blog`. Optional, so an unpinned post omits it rather than writing `false`.")
  - `pinned: z.boolean().optional(),`
- No change to `toBlogPost`: it already `parse`s, so `pinned: "yes"` throws at module evaluation and fails the build.

### 3. Replace the sorter

- Rename `sortPostsByDateDesc` to `sortPosts` in `schema.ts`.
- Body: `return [...posts].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.date.localeCompare(a.date));`
- Update the doc comment: pinned posts first, each group newest first; `yyyy-MM-dd` is lexicographically ordered so no `Date` is constructed; `Array.prototype.sort` is stable, so posts with equal keys keep their registry order; returns a new array, input not mutated.
- `grep -rn "sortPostsByDateDesc" apps/website` and update every reference (expected: `posts.ts`, the unit test, the app doc).

### 4. Wire the registry

- In `apps/website/src/lib/blog/posts.ts`, import `sortPosts` instead of `sortPostsByDateDesc` and set `export const allPosts: BlogPost[] = sortPosts(posts);`. Leave `getPostBySlug` and `assertUniqueSlugs` as they are.

### 5. Extend the unit tests

- In `apps/website/src/lib/blog/__tests__/schema.unit.test.ts`:
  - Update the import to `sortPosts` and rename `describe("sortPostsByDateDesc")` to `describe("sortPosts")`; keep the three existing cases (newest first, no mutation, empty array) against `sortPosts`.
  - `toBlogPost` cases:
    - parses `pinned: true` and carries it on the result (`toBlogPost({ ...validMeta, pinned: true }, Content).pinned` is `true`).
    - throws when `pinned` is the string `"yes"`.
  - `sortPosts` cases:
    - a pinned older post sorts ahead of an unpinned newer post.
    - within the pinned group and within the unpinned group, each is newest first (e.g. input `[unpinnedOld, pinnedOld, unpinnedNew, pinnedNew]` yields `[pinnedNew, pinnedOld, unpinnedNew, unpinnedOld]`).
    - stable for equal dates: two unpinned posts with the same date keep input order, and the same for two pinned posts with the same date (assert both orders of input to prove it is input order, not slug order).
    - `pinned: false` sorts the same as omitted (treated as unpinned, stays in date order).
    - does not mutate its input when pinned posts are present.
- The `post()` helper already accepts `Partial<BlogPost>`, so `post({ slug, date, pinned: true })` works without changing it.

### 6. Add the card label

- In `apps/website/src/app/(main)/blog/ui/PostCard.tsx`, destructure `pinned` from `post` and, immediately above the date `<p>`, render `{pinned && <p className="uppercase tracking-[0.2em] text-[10px]">Pinned</p>}`. Same classes as the date line, no new colour tokens, no layout change. Keep `PostCard` a Server Component (no `"use client"`).

### 7. Add the browser test

- Create `apps/website/src/app/(main)/blog/ui/PostCard.browser.test.tsx`, modelled on `ProductCard.browser.test.tsx`:
  - `vi.mock("next/link", ...)` plain `<a>` stand-in and `vi.mock("next/image", ...)` plain `<img>` stand-in, with the same short comments, before `import { PostCard } from "./PostCard";`.
  - A fixture `BlogPost` with `Content: () => null` and no hero (hero optional).
  - Test: with `pinned: true`, `page.getByText("Pinned", { exact: true })` is in the document, and the link (`page.getByRole("link", { name: title })`) still renders with the date.
  - Test: with `pinned` omitted, `page.getByText("Pinned", { exact: true })` has zero elements (`expect.element(...).not.toBeInTheDocument()`).
  - Test: with `pinned: false`, the label is likewise absent.

### 8. Playwright spec decision (no new spec)

- Do not add or extend an `e2e/*.spec.ts`. The issue forbids pinning any real post in this change, and there is only one post, so a spec could only observe "no label", which the browser test already proves. Ordering is a pure function covered by the unit suite, and the existing blog spec explicitly delegates ordering to that layer. The card label is covered in a real DOM by the browser test, which (unlike `e2e/`) also gates on push and in CI. No agent-driven `e2e/*.md` journey either.

### 9. Update the app doc

- In `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`:
  - "What Was Built": the `/blog` bullet becomes newest first, with any pinned post ahead of the rest.
  - "Files Modified": the `schema.ts` bullet lists optional `pinned` in the contract and `sortPosts` (pinned first, then newest first, stable) instead of `sortPostsByDateDesc`. Mention `PostCard`'s "Pinned" label.
  - "How to Use": add `pinned: true, // optional; lifts the post above date order on /blog with a "Pinned" label` to the `meta` example, plus one sentence that removing it returns the post to date order and that several pinned posts sort newest first among themselves.
  - "Testing": unit bullet mentions pinned-first ordering, per-group date order, stability and the `pinned: "yes"` rejection; browser bullet adds `PostCard.browser.test.tsx`.
  - House voice, no em dashes (use commas, colons, parentheses).
- Optionally extend the doc's `docs/conditional-docs.md` entry conditions with "When pinning a blog post or changing `/blog` ordering". No new doc file, so no new index entry is required.

### 10. Manual preview verification (revert before committing)

- Temporarily add `pinned: true,` to `meta` in `apps/website/src/content/blog/welcome-to-issebya-homes.mdx`.
- `yarn turbo run build --filter=./apps/website` and confirm the route table lists `/blog` as static (○ / prerendered), not dynamic (ƒ).
- Optionally start the website on a free port (`PORT=<free> yarn workspace website dev`, never 3003/3005) and confirm `/blog` shows "Pinned" above the date on the welcome card.
- Revert the `.mdx` change (`git checkout -- apps/website/src/content/blog/welcome-to-issebya-homes.mdx`) and confirm `git diff` shows no content change.

### 11. Run the validation commands

- Run every command in `Validation Commands` and fix anything red.

## Testing Strategy

### Unit Tests

`schema.unit.test.ts` (node pool) proves the contract and ordering: `pinned: true` parses and is carried, `pinned: "yes"` throws, pinned posts precede unpinned regardless of date, each group is newest first, equal-date posts keep input order in both groups, `pinned: false` behaves as omitted, and the input array is not mutated. The existing date-only sort cases continue under the renamed `sortPosts`.

### Test Coverage

- `apps/website/src/lib/blog/__tests__/schema.unit.test.ts` (`*.unit.test.ts`): catches a pinned post not rising above newer posts, groups not ordered newest first, unstable ordering on equal dates, and a non-boolean `pinned` slipping past the schema. Fails today because `sortPosts` does not exist and `postMetaSchema` strips/ignores `pinned`.
- `apps/website/src/app/(main)/blog/ui/PostCard.browser.test.tsx` (`*.browser.test.tsx`): catches the "Pinned" label missing on a pinned card or leaking onto an unpinned one. Fails today because `PostCard` renders no label.
- No `apps/website/e2e/*.spec.ts`: no real post may be pinned in this change, so a page-level spec would only see the unpinned state, already proven by the browser test; ordering is pure logic proven by the unit suite.

### Edge Cases

- Several pinned posts: newest first within the pinned group.
- Pinned and unpinned posts sharing the same date: pinned still first.
- Equal dates within a group: registry (input) order preserved.
- `pinned: false` explicitly: identical to omitted.
- `pinned: "yes"`, `pinned: 1`, `pinned: null`: rejected by the schema, build fails.
- Empty post list: `sortPosts([])` returns `[]`.
- A pinned post with no hero: label still renders in the text column.

## Acceptance Criteria

- `postMetaSchema` accepts an optional boolean `pinned`; `BlogPost` carries it; a non-boolean value throws in `toBlogPost`.
- Exactly one exported sorter, `sortPosts`, in `schema.ts`; `sortPostsByDateDesc` no longer exists anywhere in the repo.
- `allPosts` is ordered pinned first, each group newest first, stable, as a new array.
- `PostCard` shows "Pinned" in the date line's uppercase tracked style only when `pinned` is true; no new colour tokens.
- `/blog` still reads nothing from the request and is listed as static in the build output.
- `welcome-to-issebya-homes.mdx` is unchanged in the commit.
- The app doc describes `pinned` in the `meta` contract, with no em dashes.
- All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `grep -rn "sortPostsByDateDesc" apps/website || echo "none"` - Confirms the old sorter name is gone everywhere
- `git diff --exit-code -- apps/website/src/content/blog/` - Confirms no post was pinned in this change
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser (chromium) tests pass, including the new pinned cases and `PostCard.browser.test.tsx`
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and `/blog` is listed as static

## Notes

- No new dependencies.
- `Array.prototype.sort` stability is part of the spec since ES2019, so stability needs no partition or index tiebreak.
- Out of scope, per the issue: an explicit order among several pinned posts beyond date, a pinned section header, or a different card layout. If an explicit order is ever wanted, the natural extension is replacing the boolean with a numeric `pinOrder`, which `sortPosts` could compare before date without touching any call site.
- `/blog/[slug]` and `sitemap.ts` read `allPosts` but are order-insensitive, so they are unaffected.
