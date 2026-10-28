# Feature: Forest bathing blog post

## Metadata

issue_number: `217`
adw_id: `bf15ab13`
issue_json: `{"number":217,"title":"website: new blog post about forest bathing"}`

## Feature Description

Add a second post to the `apps/website` blog: `apps/website/src/content/blog/forest-bathing.mdx`, titled "Forest bathing: a slow walk in the Sintra woods". The house sits at the edge of the Sintra forest and forest walks are part of the stay, so a short, calm post on forest bathing (shinrin-yoku) fits the voice of the existing welcome post. The body is exactly five sentences supplied verbatim by the issue, with no headings, lists, widgets or calls to action. The post reuses an existing image from `apps/website/public/` as its hero; no new binary files are added.

## User Story

As a prospective guest reading the issebya.homes blog
I want to read a short note on forest bathing in the Sintra woods
So that I can picture a slow morning in the forest as part of my stay

## Problem Statement

`/blog` has a single post. Forest walks are one of the house's core experiences, but nothing on the site explains the practice or ties it to the forest a few minutes up the road.

## Solution Statement

Follow the existing content pipeline exactly, with no code changes beyond registration:

1. Create `forest-bathing.mdx` with an `export const meta = {...}` block (`title`, `description`, `date`, `slug`, `hero`) followed by the five verbatim sentences.
2. Register it in the explicit post registry `apps/website/src/lib/blog/posts.ts` (an import plus a `toBlogPost(...)` entry). The registry is deliberately explicit, so an unimported post does not exist. `/blog`, `/blog/[slug]`, `generateStaticParams` and `sitemap.ts` pick it up from there.
3. Extend the existing Playwright spec so the index ordering (new post first) and the new post's rendering are asserted.

Field values:

- `title`: `"Forest bathing: a slow walk in the Sintra woods"`
- `description`: `"An unhurried morning among the trees of the Sintra forest, a few minutes up the road from the house, and why it rests the body and the mind."` (139 characters, under the issue's 160 cap and the schema's 200 cap; plain, no marketing adjectives, no em-dashes)
- `date`: `"2026-10-03"` (today; the welcome post is `2026-09-21`, so the new post sorts first)
- `slug`: `"forest-bathing"` (matches the filename, valid kebab-case)
- `hero`: `{ src: "/frontyard.webp", alt: "The front yard at issebya.homes: a leafy tree, rosemary bushes and aloe on gravel beside the whitewashed house with blue trim", width: 1920, height: 1280 }`. Of the images in `public/`, `frontyard.webp` is the only one where greenery is the subject (the tree on the left, the rosemary hedge and aloe on the right); the others are interiors or the terrace, where the forest is a distant strip. Dimensions verified with `sips`: 1920x1280. The alt describes what is actually in the photo and does not claim it shows the forest.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo-wide rules: yarn only, conventional commits, lefthook formats `.mdx` on commit.
- `apps/website/AGENTS.md` - workspace rules: calendar days are `yyyy-MM-dd` strings (the post `date`), and the Playwright `e2e/` suite is not in CI but is run by the ADW test phase.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` - matched in `docs/conditional-docs.md` ("When adding, editing or removing a blog post under `apps/website/src/content/blog/`"). Its "How to Use" section is the procedure for adding a post.
- `apps/website/src/content/blog/welcome-to-issebya-homes.mdx` - the shape to copy (meta block layout, quoting, paragraph wrapping). Must not be modified.
- `apps/website/src/lib/blog/posts.ts` - the explicit registry; the new post must be imported and added here.
- `apps/website/src/lib/blog/schema.ts` - the `zod` meta contract the new `meta` must satisfy (title <= 120, description 1-200, real `YYYY-MM-DD` date, kebab-case slug, hero with root-relative `src`, non-empty `alt`, positive integer `width`/`height`). `sortPosts` is pinned-first then newest-first. Not modified.
- `apps/website/src/app/(main)/blog/page.tsx`, `apps/website/src/app/(main)/blog/[slug]/page.tsx`, `apps/website/src/app/(main)/blog/ui/PostCard.tsx` - the routes and card that render the post; not modified, read to know what to assert (each card is one link labelled by the post title; the post page renders an `<article>` with an `h1` and the hero via `next/image`).
- `apps/website/src/app/sitemap.ts` - picks the post up from `allPosts`; not modified.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` - the existing blog spec to extend. Its "index lists the post and links to it" test currently carries a comment saying ordering is not checked because there is a single post; that comment goes stale with this change.
- `apps/website/public/frontyard.webp` - the reused hero image (1920x1280). Not modified.
- `lefthook.yml`, `.prettierrc.json` - prettier runs on `.mdx` on commit with `printWidth: 100` and default `proseWrap: "preserve"`, so the hand-wrapped body is left as written.

### New Files

- `apps/website/src/content/blog/forest-bathing.mdx` - the new post.

## Implementation Plan

### Phase 1: Foundation

Nothing to build: the MDX pipeline, schema, registry, routes and sitemap already exist. Confirm the hero choice and its dimensions (`frontyard.webp`, 1920x1280) and that the welcome post has no `pinned` flag, so plain date order applies and the new post (2026-10-03) sorts ahead of the welcome post (2026-09-21).

### Phase 2: Core Implementation

Create `forest-bathing.mdx` with the meta block and the five verbatim sentences as two short paragraphs:

- Paragraph 1: sentences 1 and 2 (what it is, where it comes from).
- Paragraph 2: sentences 3, 4 and 5 (how to do it, what it does, how it fits the stay).

### Phase 3: Integration

Register the post in `posts.ts` and extend the blog Playwright spec to assert index order and the post page.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conditional docs

- Read `apps/website/AGENTS.md` and `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` ("How to Use").

### 2. Create the post

- Create `apps/website/src/content/blog/forest-bathing.mdx` with exactly this content (the body text must match the issue verbatim, including "1980s", "shinrin-yoku", the semicolon and the colon in sentence 3, and "a calmer heart rate and a quieter mind" with no Oxford comma):

```mdx
export const meta = {
  title: "Forest bathing: a slow walk in the Sintra woods",
  description:
    "An unhurried morning among the trees of the Sintra forest, a few minutes up the road from the house, and why it rests the body and the mind.",
  date: "2026-10-03",
  slug: "forest-bathing",
  hero: {
    src: "/frontyard.webp",
    alt: "The front yard at issebya.homes: a leafy tree, rosemary bushes and aloe on gravel beside the whitewashed house with blue trim",
    width: 1920,
    height: 1280,
  },
};

Forest bathing is the simple practice of spending unhurried time among trees, with no destination
and no pace to keep. It began in Japan in the 1980s under the name shinrin-yoku, when doctors
noticed that time in the woods lowered stress in people who worked long hours in cities.

You do not hike or exercise; you walk slowly, stop often, and let your senses do the work: the
smell of damp bark, the sound of wind in the canopy, the light moving on the path. Studies since
then have linked even an hour under trees to lower blood pressure, a calmer heart rate and a
quieter mind. From the house, the Sintra forest starts a few minutes up the road, which makes a
morning of forest bathing the easiest ritual to add to a stay.
```

- No headings, lists, `<BookingWidget />`, links, emoji sign-off or call to action.
- No `pinned` field.
- Run `yarn prettier --write apps/website/src/content/blog/forest-bathing.mdx` then `git diff` the file: the `meta` block must be unchanged by prettier (it is already in prettier's output shape: the long `description` breaks after `description:`, matching the welcome post). If prettier reflows anything in the meta block, adjust the source until a `--write` is a no-op.

### 3. Register the post

- In `apps/website/src/lib/blog/posts.ts`, add below the existing import:
  ```ts
  import ForestBathing, { meta as forestBathingMeta } from "@/content/blog/forest-bathing.mdx";
  ```
  and extend the array:
  ```ts
  const posts: BlogPost[] = [
    toBlogPost(welcomeToIssebyaHomesMeta, WelcomeToIssebyaHomes),
    toBlogPost(forestBathingMeta, ForestBathing),
  ];
  ```
- Do not touch `schema.ts`, `sortPosts`, `PostCard.tsx` or the welcome post. Ordering comes from `sortPosts`, not registry order.
- Let prettier format `posts.ts` (it may keep the new import on one line at `printWidth: 100`).

### 4. Extend the blog Playwright spec

In `apps/website/e2e/blog-booking-flow.integration.spec.ts`:

- Add constants next to the existing ones:
  ```ts
  const FOREST_POST = "/blog/forest-bathing";
  const FOREST_TITLE = "Forest bathing: a slow walk in the Sintra woods";
  ```
- Replace the stale comment in "index lists the post and links to it" (it says there is a single post, so ordering is only covered by the unit test). The test still clicks the welcome post by title, which keeps working with two posts.
- Add a test `"index lists the forest bathing post first, with its description"`:
  - `page.goto("/blog")`.
  - Scope to `page.getByRole("region", { name: "Posts" })` (the `<section aria-label="Posts">`) and its `listitem`s; assert the first `listitem` contains a link named `FOREST_TITLE` and the description text, and the second contains a link named `POST_TITLE`. This proves newest-first with the real registry and that the welcome post is still listed.
- Add a test `"the forest bathing post renders its hero and body"`:
  - `page.goto(FOREST_POST)`.
  - `getByRole("heading", { level: 1, name: FOREST_TITLE })` is visible.
  - `page.locator("article").getByRole("img", { name: /front yard at issebya\.homes/ })` is visible (the hero via `next/image`).
  - Assert the first and last sentences are visible inside `article` with `getByText(...)` on a distinctive substring, e.g. `"Forest bathing is the simple practice of spending unhurried time among trees"` and `"the easiest ritual to add to a stay"`.
  - Assert `page.locator("article").getByTestId("booking-widget")` has count 0 (no call to action / widget was added).
- Keep the existing welcome-post tests unchanged.

### 5. Run the validation commands

- Run every command in `Validation Commands` and fix anything that fails.

## Testing Strategy

### Unit Tests

None added. `sortPosts`, the meta schema (including the hero shape and date validation) and the duplicate-slug guard are already covered by `src/lib/blog/__tests__/schema.unit.test.ts`, and this change does not alter any of that logic. The registry module `posts.ts` imports `.mdx`, which the vitest node pool cannot transform, so a unit test of "the real registry contains this post" is not possible at that layer; the build is the gate there, because `toBlogPost` parses `meta` at module scope and a malformed post fails `next build`.

### Test Coverage

- `apps/website/e2e/blog-booking-flow.integration.spec.ts` "index lists the forest bathing post first, with its description": catches the post not being registered in `posts.ts` (the most likely mistake, since the registry is explicit) and a wrong `date` that sorts it below the welcome post. Fails without this change because no such card exists.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` "the forest bathing post renders its hero and body": catches a missing/broken hero, a slug/filename mismatch (404) and truncated body text. Fails without this change because `/blog/forest-bathing` is a 404.
- No `*.browser.test.tsx`: no component changes; `PostCard` and the post route are unchanged and already tested.

### Edge Cases

- Pinning from #212 untouched: the welcome post has no `pinned` flag, so with neither pinned the new post sorts first by date. Do not add `pinned` to either post.
- `description` length: 139 characters, under the issue's 160 and the schema's 200.
- Prettier on MDX: the meta block must survive `prettier --write` unchanged; the body is `proseWrap: "preserve"` so line breaks inside paragraphs are kept.
- MDX parsing of the body: the text contains a semicolon, a colon and a hyphenated word, none of which are JSX or markdown syntax; no `{`, `<` or leading `-`/`#` that MDX would interpret.
- Hero image alt is honest: describes a front yard with plants, not a forest.
- Sitemap gains `/blog/forest-bathing` automatically with `lastModified` from the post date; no change to `sitemap.ts`.

## Acceptance Criteria

- `apps/website/src/content/blog/forest-bathing.mdx` exists with `title`, `description` (<160 chars), `date: "2026-10-03"`, `slug: "forest-bathing"` and a `hero` reusing `/frontyard.webp` (1920x1280) with an honest alt.
- The body is exactly the five sentences from the issue, verbatim, in two paragraphs, with nothing else.
- `/blog` lists the new post first, with its title and description, followed by the welcome post.
- `/blog/forest-bathing` renders the title, the hero and the five sentences.
- `welcome-to-issebya-homes.mdx`, `schema.ts`, `PostCard.tsx` and the pinning behaviour are unchanged; no new files under `public/`.
- `prettier --check` passes and `prettier --write` leaves the `meta` block unchanged.
- Lint, typecheck, knip, unit/browser tests and the production build pass; the extended Playwright spec passes in the test phase.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `git diff --stat -- apps/website/public apps/website/src/content/blog/welcome-to-issebya-homes.mdx apps/website/src/lib/blog/schema.ts` - Must print nothing: no new binaries, welcome post and schema untouched
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; this also validates the new `meta` against the schema at module scope and prerenders `/blog/forest-bathing`

## Notes

- No new dependencies.
- The issue says "today's date"; the plan pins `2026-10-03`, the planning date. If implementation lands on a later day, use that day instead (still `YYYY-MM-DD`, still later than `2026-09-21`).
- Description and alt text avoid em-dashes and marketing adjectives, matching the welcome post's tone.
- No agent-driven `e2e/*.md` journey: the Playwright spec covers the user-visible behaviour deterministically.
- The extended spec runs in the ADW test phase (`yarn workspace website test:integration`), not in CI, per `apps/website/AGENTS.md`. The CI-gated proof that the post is valid is the production build.
