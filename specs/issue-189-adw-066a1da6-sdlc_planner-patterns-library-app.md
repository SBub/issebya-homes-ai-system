# Feature: apps/patterns, a pattern library rendered from MDX

## Metadata

issue_number: `189`
adw_id: `066a1da6`
issue_json: `{"number":189,"title":"New app apps/patterns: a pattern library (atoms + composites) rendered from MDX, read by the owner when planning and by agents from disk"}`

## Feature Description

A new Next 16 workspace, `apps/patterns`, that turns the React/Next patterns proven in the shop work (#139 to #176) into a small documentation site. Each pattern is one MDX file under `apps/patterns/content/<slug>.mdx` with validated YAML frontmatter and a fixed section order. An atom is a single technique; a composite names the atoms it combines (`uses`). Every doc links to the exact repo files that prove it, pinned to a commit SHA, so a link never drifts.

The same content serves two readers:

- the owner, in a browser, when planning: `/` lists atoms and composites, `/p/[slug]` renders one doc with a "Combines" / "Used by" side panel and the code links;
- coding agents, from disk: the raw `.mdx` files plus a generated `content/INDEX.md` in the "read X when Y" style of `docs/conditional-docs.md`, which itself gets one entry pointing at the index.

The app is fully prerendered, ships no client JavaScript beyond what Next needs, and has three seed docs written from the real shop code: `server-prefetch-hydration` (atom), `suspense-without-flash` (atom), `infinite-scrolling` (composite).

## User Story

As the owner (and as a coding agent working in this repo)
I want one short page per proven UI pattern, with the mechanism, a minimal excerpt, the pitfalls and a pinned link to the code that runs it
So that I can plan the next Next feature from what already works instead of rediscovering it from closed issues and code comments

## Problem Statement

The knowledge behind the shop (server prefetch with hydration, Suspense placement, transitions, error boundaries around a Suspense hole, `"use cache"` with tags, keyset cursors, URL as state, debounced input, sentinel with a button fallback) lives only in JSDoc comments and closed issues. Nothing indexes it by "when would I need this", nothing shows how the pieces combine, and an agent planning a new Next feature has no pointer to it at all.

## Solution Statement

Scaffold `apps/patterns` from `apps/website`'s tooling (same lint, format, typecheck, vitest unit pool, Tailwind v4, `@next/mdx`), minus Sentry, Supabase, PostHog and the browser test pool. Content is YAML-frontmatter MDX:

- **Frontmatter** is YAML (not the blog's `export const meta`), because the agents' reading surface is the raw file and because two node-side tools (the index generator and the unit tests) must read it without an MDX compiler. It is exposed to the bundle through `remark-frontmatter` + `remark-mdx-frontmatter` (passed to `createMDX` by string name, which Turbopack accepts), and parsed on the node side with the `yaml` package. Both paths run the same Zod schema.
- **Pure logic** lives in `src/lib/patterns/` modules that import no `.mdx` and no `node:fs`, so the vitest node pool can test them: `schema.ts` (Zod + cross-doc checks), `sections.ts` (heading extraction and order check), `index-md.ts` (renders `INDEX.md` text), `manifest.ts`-rendering (renders the registry source), `links.ts` (GitHub blob/raw URL builders).
- **Disk access** lives only in `src/lib/patterns/read-content.ts` (node only; imported by the scripts and the tests, never by a route).
- **Registry**: `scripts/build-index.ts` (`yarn workspace patterns index`, run in `prebuild`) writes two checked-in files: `content/INDEX.md` and `src/lib/patterns/manifest.generated.ts` (explicit `import X, { frontmatter as xMeta } from "@/../content/<slug>.mdx"` lines). `src/lib/patterns/registry.ts` imports the manifest, validates every entry at module scope with `parse` (so a bad doc fails the build, exactly like `src/lib/blog/posts.ts`), and resolves `uses` and the reverse "used by" edges. No runtime `readdir` anywhere a route imports. Unit tests assert both generated files equal what the generator would write now, so adding a doc without regenerating fails `test`.
- **Auto-rendered sections**: `## Combines` and `## Code` headings are written in the MDX (so the order test and on-disk readers see them), each followed by a single component tag, `<Combines />` and `<CodeLinks />`. The route passes those components bound to the current doc through the MDX `components` prop. A unit test rejects any other content inside those two sections, which is what "no hand-written links" means in practice.
- **Syntax highlighting**: `rehype-pretty-code` (with its `shiki` peer), at build time, so highlighted code is static HTML and costs no client JS.

## Relevant Files

Use these files to implement the feature:

- `README.md` - repo overview; gets a short `apps/patterns` entry under Projects.
- `AGENTS.md` - repo rules. Ports section gets the `apps/patterns` 3004 line; the Python section's rule "every new Node app must be added to `pyproject.toml` exclude" applies here.
- `docs/conditional-docs.md` - agents' index; gets a new `## apps/patterns` section with the `content/INDEX.md` entry and the `apps/patterns/AGENTS.md` always-entry.
- `pyproject.toml` - `[tool.uv.workspace] exclude` needs `"apps/patterns"`.
- `turbo.json` - read only: `build` outputs already cover `.next/**`; tasks `build/dev/test/typecheck/lint/format:check` pick up the new workspace with no change.
- `knip.json` - needs an `apps/patterns` workspace block (entry: unit tests and `scripts/**/*.ts`; `next: true`; same `ignoreDependencies` as the website).
- `lefthook.yml` - read only: `mdx` is already in the prettier glob, so content files are formatted on commit.
- `.prettierignore` - read only; generated files must be prettier-clean as written (see Notes).
- `eslint.config.base.mjs` - shared ESLint blocks; note `security/detect-non-literal-fs-filename` is an error, which affects `read-content.ts` and the scripts.
- `scripts/vercel-ignore.sh` - the `ignoreCommand` every app's `vercel.json` runs.
- `scripts/vercel-prune-previews.ts` - `PROJECTS` list; deliberately not changed now (the Vercel project does not exist yet), called out in the PR as an owner follow-up.
- `apps/website/package.json` - scripts and dependency versions to copy.
- `apps/website/next.config.ts` - `createMDX` setup and the Turbopack plugin-by-name constraint.
- `apps/website/tsconfig.json`, `apps/website/eslint.config.mjs`, `apps/website/postcss.config.mjs`, `apps/website/vitest.config.ts`, `apps/website/.gitignore` - config to copy and trim.
- `apps/website/src/mdx-components.tsx` - required-by-`@next/mdx` file and the typography mapping to mirror.
- `apps/website/src/app/layout.tsx`, `apps/website/src/app/globals.css` - fonts (`Work_Sans`, `Nothing_You_Could_Do`) and colours (`#f0eeea` ground, `shop-ground`, `shop-card`, `text-secondary-link`) to reuse.
- `apps/website/src/lib/blog/schema.ts`, `apps/website/src/lib/blog/posts.ts` - the validation-at-module-scope and explicit-import registry pattern to follow; the kebab slug regex that avoids `detect-unsafe-regex`; the calendar-day refine.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx` - `generateStaticParams` + `notFound()` without `dynamicParams`, under `cacheComponents`.
- Seed-doc sources (read every one at SHA `a1410c6b3afa1ac500fc7018ca1ad42d5956e3b0` before writing a sentence about it):
  - `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` - `"use cache"` + `cacheTag("shop-products")` + `cacheLife("days")` around `prefetchInfiniteQuery` + `dehydrate`; `HydrationBoundary`; why the cache scope is required (`next-prerender-current-time`).
  - `apps/website/src/app/(main)/shop/ui/ProductList.tsx` - `useSuspenseInfiniteQuery` with the shared key, `refetchOnMount: false`, callback-ref `IntersectionObserver` sentinel, "Load more" button fallback, next-page retry line.
  - `apps/website/src/lib/shop/query-client.ts` - `makeShopQueryClient` shared by server and client; pending queries dehydrated.
  - `apps/website/src/app/(main)/shop/page.tsx` - static shell, two Suspense boundaries, fallbacks sized like content.
  - `apps/website/src/app/(main)/shop/ui/ShopControls.tsx` - `useTransition` for `isPending` (grid dimmed, `aria-busy`), `useOptimistic` sort, URL as state.
  - `apps/website/src/app/(main)/shop/ui/ShopGridBoundary.tsx` - error boundary outside the Suspense hole; bare `startTransition` around `router.refresh()` + `resetError()`.
  - `apps/website/src/lib/shop/pagination.ts` - keyset `(createdAt, slug)`, opaque base64url cursor, `shopProductsQueryKey`, `nextCursor: null` at the end.
  - `apps/website/src/app/api/shop/products/route.ts` - pages 2+ only; cursor decoded outside the cache so a bad cursor is a 400.

Documentation matched in `docs/conditional-docs.md`:

- `apps/website/app_docs/nextjs-patterns-guide.md` - adding routes and Server Components (applies to the new app's routes).
- `apps/website/app_docs/zod-validation-guide.md` - Zod conventions for the frontmatter schema.
- `apps/website/app_docs/testing/unit_test_spec_format.md` - unit test format.
- `apps/website/app_docs/feature-e50e5d95-shop-infinite-scroll-grid.md`, `feature-12e4efa7-shop-grid-error-boundary.md`, `feature-8ad2fc3b-shop-controls-static-shell.md`, `feature-bdeb9a75-shop-server-side-sort.md` - background for the seed docs.
- `apps/website/app_docs/branding-guidelines.md` - colours and type for the shell.
- `apps/website/AGENTS.md` - conventions the new app copies (calendar days, `next/image`, etc.).

### New Files

- `apps/patterns/package.json` - name `patterns`; scripts `dev` (`next dev -p ${PORT:-3004}`), `build` (`next build`), `prebuild` (`yarn index`), `index` (`tsx scripts/build-index.ts`), `start` (`next start -p ${PORT:-3004}`), `typecheck` (`next typegen && tsc --noEmit`), `test` (`vitest run`), `lint`, `lint:fix`, `format`, `format:check`, `check-links` (`tsx scripts/check-code-links.ts`); `"type": "module"`; `engines.node >=22.13.0`.
- `apps/patterns/next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts` (unit project only), `.gitignore`, `next-env.d.ts` (generated by typegen; commit if the website commits its own).
- `apps/patterns/vercel.json` - identical to `apps/website/vercel.json`.
- `apps/patterns/README.md`, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md` only).
- `apps/patterns/src/mdx-components.tsx`
- `apps/patterns/src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/p/[slug]/page.tsx`
- `apps/patterns/src/app/ui/PatternCard.tsx`, `CodeLinks.tsx`, `Combines.tsx`, `RelationsPanel.tsx`
- `apps/patterns/src/lib/patterns/schema.ts`, `sections.ts`, `links.ts`, `index-md.ts`, `manifest-source.ts`, `read-content.ts`, `registry.ts`, `manifest.generated.ts`, `mdx.d.ts` (module declaration for `*.mdx` exporting `frontmatter: unknown`)
- `apps/patterns/src/lib/patterns/__tests__/schema.unit.test.ts`, `sections.unit.test.ts`, `content.unit.test.ts`, `generated.unit.test.ts`, `links.unit.test.ts`
- `apps/patterns/scripts/build-index.ts`, `scripts/check-code-links.ts`
- `apps/patterns/content/server-prefetch-hydration.mdx`, `suspense-without-flash.mdx`, `infinite-scrolling.mdx`, `INDEX.md`

## Implementation Plan

### Phase 1: Foundation

Workspace scaffold and repo wiring: `package.json`, config files copied from the website and trimmed (no Sentry wrapper, no `transpilePackages`, keep `cacheComponents: true` and `turbopack.root`), `vercel.json`, `pyproject.toml` exclude, `knip.json` block, `yarn install` to create the lockfile entry, `uv sync` to prove the exclude works. Minimal layout with the site's fonts and ground colour.

### Phase 2: Core Implementation

Pure modules first, each with its unit test: frontmatter schema and cross-doc validation, section extraction and order check, link builders, `INDEX.md` renderer, manifest source renderer. Then the node-only reader, the generator script, the registry, the MDX components and the two routes. Then the three seed docs, written line by line against the pinned files, and the generated `INDEX.md` and manifest.

### Phase 3: Integration

Docs: app README/AGENTS/CLAUDE, root `AGENTS.md` port line, root README project entry, `docs/conditional-docs.md` section. Link check script run against GitHub with output pasted in the PR. Build and confirm `/` and `/p/<slug>` are prerendered. Screenshots at 1280 and 390 px. PR body states the owner's Vercel steps.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read before writing

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/nextjs-patterns-guide.md`, `apps/website/app_docs/zod-validation-guide.md`, `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/branding-guidelines.md`.
- Record the pin: `git rev-parse origin/develop`. At planning time it is `a1410c6b3afa1ac500fc7018ca1ad42d5956e3b0` and is on GitHub (`git ls-remote origin develop`). If develop has moved, use the new SHA only if it is on the remote and every seed file still says what the doc claims; otherwise keep `a1410c6…`. Never a branch name.

### 2. Scaffold the workspace

- Create `apps/patterns/package.json` (name `patterns`, scripts as listed in New Files). `dev` is plain `next dev -p ${PORT:-3004}`; no `scripts/start.ts`.
- Add dependencies with yarn, never by hand-editing versions:
  - `yarn workspace patterns add next react react-dom @next/mdx @mdx-js/loader @mdx-js/react zod yaml remark-frontmatter remark-mdx-frontmatter rehype-pretty-code shiki`
  - `yarn workspace patterns add -D typescript @types/node @types/react @types/react-dom @types/mdx eslint eslint-config-next eslint-config-prettier eslint-plugin-no-secrets eslint-plugin-security prettier tailwindcss @tailwindcss/postcss vitest vite vite-tsconfig-paths tsx`
  - Match the website's major versions (Next 16, React 19.2, Zod 4, Vitest 4, Tailwind 4, TypeScript pinned as at root).
- `next.config.ts`: `cacheComponents: true`, `reactStrictMode: true`, `turbopack.root` as in the website, `pageExtensions` untouched. `createMDX({ options: { remarkPlugins: ["remark-frontmatter", ["remark-mdx-frontmatter", { name: "frontmatter" }]], rehypePlugins: [["rehype-pretty-code", { theme: "github-light" }]] } })`. Plugins by string name only, options JSON-serialisable (Turbopack). Comment why.
- `tsconfig.json`: copy the website's, drop its app-specific excludes, keep `@/*` → `./src/*`; include `scripts/**/*.ts`. Content is imported via a relative path or an added `@content/*` alias → `./content/*` (add to both tsconfig `paths` and nothing else; `vite-tsconfig-paths` picks it up in vitest).
- `eslint.config.mjs`: `...nextConfig, ...securityAndFormatConfig` from `../../eslint.config.base.mjs`, ignores `.next/**`.
- `postcss.config.mjs`: copy. `vitest.config.ts`: a single `unit` project, `include: ["src/**/*.unit.test.ts"]`, `environment: "node"`, plugins `[tsconfigPaths()]`. No browser project (see Test Coverage).
- `.gitignore`: `.next/`, `next-env.d.ts` only if the website ignores it (check the root `.gitignore`), `.vitest-attachments/`.
- `vercel.json`: `{ "$schema": "https://openapi.vercel.sh/vercel.json", "ignoreCommand": "bash ../../scripts/vercel-ignore.sh" }`.
- `pyproject.toml`: add `"apps/patterns",` to `[tool.uv.workspace] exclude` (keep the list sorted).
- `knip.json`: add `"apps/patterns": { "next": true, "entry": ["src/**/*.unit.test.ts", "scripts/**/*.ts"], "project": ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts"], "ignoreDependencies": ["tailwindcss", "eslint-config-prettier", "eslint-plugin-no-secrets", "eslint-plugin-security"] }`. If knip flags `remark-frontmatter`, `remark-mdx-frontmatter`, `rehype-pretty-code` or `shiki` as unused (they are referenced only as strings in `next.config.ts`), add them to this workspace's `ignoreDependencies` with a comment in the PR, not a blanket ignore.
- Run `yarn install` (creates the lockfile entry) and `uv sync` (must succeed; proves the exclude).

### 3. Shell: layout, styles, MDX components

- `src/app/globals.css`: `@import "tailwindcss";` plus the website's `@theme inline` fonts and colours needed here (`--font-sans: var(--font-work)`, `--color-shop-ground`, `--color-shop-card`) and the `text-secondary-link` utility. Styles for `rehype-pretty-code` output (`figure[data-rehype-pretty-code-figure] pre` padding, overflow-x auto, small radius, `data-line` spacing).
- `src/app/layout.tsx`: `Work_Sans` + `Nothing_You_Could_Do` via `next/font/google` as in the website, `bg-[#f0eeea]` ground, a small header with the app name linking to `/`. Metadata title "Patterns - issebya.homes", `robots: { index: false }` (internal tool). No client components.
- `src/mdx-components.tsx`: required by `@next/mdx`; mirror the website's h2/h3/p/a/ul/ol/li mapping; inline `code` styling; external `a` open in the same tab. Do not register `Combines` / `CodeLinks` globally; the route passes them per doc.

### 4. Frontmatter schema (`src/lib/patterns/schema.ts`) with its test

- Zod schema, imports only `zod` and a `ComponentType` type:
  - `title`: trimmed, 1..80.
  - `kind`: `z.enum(["atom", "composite"])`.
  - `summary`: one sentence, trimmed, 1..200, must end with `.` and contain no `. ` in the middle (refine), no `—` (house rule).
  - `tags`: array of kebab strings, min 1.
  - `uses`: array of kebab slugs, optional; required non-empty when `kind === "composite"`, forbidden for atoms (superRefine or a discriminated union on `kind`).
  - `code`: array min 1 of `{ path, ref, note }`: `path` a repo-relative path (no leading `/`, no `..`, no `://`), `ref` `/^[0-9a-f]{40}$/` with message "code.ref must be a 40-character commit SHA", `note` trimmed 1..160.
  - `verifiedIn`: array min 1 of positive ints (PR numbers).
  - `updated`: calendar day, same regex + real-date refine as the blog's `postDateSchema` (reimplement the refine locally with `new Date(`${day}T00:00:00Z`)` and a round-trip check; do not import from the website).
- Slug rule identical to the blog's (flat class + refine, not the nested quantifier, for `security/detect-unsafe-regex`).
- Export `type PatternMeta`, `type PatternDoc = PatternMeta & { slug: string; Content: ComponentType<{ components?: MDXComponents }> }`, `parsePatternMeta(raw: unknown, slug: string)` (uses `parse`; wraps the ZodError message with the slug so a build failure names the file), and `validateCollection(docs: { slug; meta }[])`: throws on duplicate slug, on a `uses` slug that does not exist ("<slug> uses unknown pattern \"x\""), on a composite using itself, and on a `uses` entry that points at a composite (atoms only, as the issue defines composites over atoms; relax later if wanted). Also export `usedBy(slug, docs)`.
- `__tests__/schema.unit.test.ts`: valid atom and composite pass; rejects `ref: "develop"`, a 7-char short SHA, and a 40-char non-hex string; rejects composite without `uses`; rejects atom with `uses`; `validateCollection` rejects a composite with an unknown `uses` slug and duplicate slugs; rejects a bad `updated` like `2026-02-31`; rejects a summary containing an em dash.

### 5. Section order (`src/lib/patterns/sections.ts`) with its test

- `extractH2Headings(body: string): string[]`: strips YAML frontmatter, then walks lines tracking fenced code blocks (``` and ~~~, any length ≥3) so a `## ` inside a code sample is ignored; returns `## ` headings in order.
- `expectedSections(kind)`: atom → `["Problem", "Mechanism", "Pattern", "Pitfalls", "When not to use", "Code"]`; composite → `["Problem", "Mechanism", "Combines", "Pattern", "Pitfalls", "When not to use", "Code"]`.
- `checkSections(body, kind): string[]` returns problems (empty when fine): headings must equal the expected list exactly (no missing, extra or reordered H2s); the `Code` section body must be exactly `<CodeLinks />`, and `Combines` exactly `<Combines />` (whitespace-insensitive); no markdown or HTML links anywhere in `## Code`.
- `__tests__/sections.unit.test.ts`: a correct atom and composite pass; swapped `Pitfalls`/`Pattern` fails; missing `When not to use` fails; `Combines` on an atom fails; a hand-written link under `## Code` fails; a `## Problem` inside a fenced block is ignored.

### 6. Link builders (`src/lib/patterns/links.ts`) with its test

- `REPO = "SBub/issebya-homes-ai-system"`; `blobUrl({ path, ref })` → `https://github.com/SBub/issebya-homes-ai-system/blob/<ref>/<path>`; `rawUrl` → `https://raw.githubusercontent.com/SBub/issebya-homes-ai-system/<ref>/<path>`. Encode each path segment with `encodeURIComponent` (the shop paths contain `(main)` and `[slug]`-style segments; parentheses stay as-is under `encodeURIComponent`, square brackets become `%5B`/`%5D`, which GitHub accepts).
- `__tests__/links.unit.test.ts`: exact URL for `apps/website/src/app/(main)/shop/page.tsx` at a fixed SHA.

### 7. Index and manifest renderers with the reader and generator

- `src/lib/patterns/index-md.ts`: `renderIndexMd(docs: { slug; meta }[]): string`. Header in the style of `docs/conditional-docs.md` (title, one paragraph saying it is generated by `yarn workspace patterns index`, do not edit by hand, paths relative to `apps/patterns/`), then `## Atoms` and `## Composites`, each sorted by slug, one line per doc: `- [<title>](content/<slug>.mdx) — read when: <summary>`. The em dash in that line is the format the issue specifies for this machine-read index and matches `docs/conditional-docs.md`; it is the only one allowed (copy rules apply to doc prose). Output must be prettier-stable (trailing newline, blank lines around headings).
- `src/lib/patterns/manifest-source.ts`: `renderManifest(slugs: string[]): string`: a header comment ("generated, do not edit"), one import per doc (`import Doc0, { frontmatter as meta0 } from "@content/<slug>.mdx";` using a camelCase identifier derived from the slug), and `export const manifest = [{ slug, meta, Content }, ...] as const;`. Prettier-stable formatting (100 cols, double quotes).
- `src/lib/patterns/read-content.ts` (node only, header comment saying never import from a route): `CONTENT_DIR = fileURLToPath(new URL("../../../content/", import.meta.url))`; `readContent()` lists `*.mdx` in that directory (sorted), reads each, splits YAML frontmatter with a small `---` delimiter parser and `yaml.parse`, returns `{ slug, raw, body, meta }` with `meta` parsed by `parsePatternMeta`, then runs `validateCollection`. The fs calls take a path joined from the constant dir and a listed filename; add `// eslint-disable-next-line security/detect-non-literal-fs-filename` with a one-line reason on each.
- `scripts/build-index.ts`: calls `readContent()`, runs `checkSections` on every doc (throws listing all problems), writes `content/INDEX.md` and `src/lib/patterns/manifest.generated.ts` only when content differs, logs what it wrote.
- `__tests__/generated.unit.test.ts`: `readFileSync(content/INDEX.md)` equals `renderIndexMd(readContent())`, and `manifest.generated.ts` equals `renderManifest(slugs)`; failure message says "run `yarn workspace patterns index`". Also a pure test that `renderIndexMd` of two fixture docs gives the exact expected lines (so a doc added without regenerating is provably caught: the fixture shows a different output for a different set).
- `__tests__/content.unit.test.ts`: over the real content directory: every doc's frontmatter parses, `validateCollection` passes, `checkSections(body, kind)` returns `[]` for every doc, and every `code.path` exists on disk at the repo root (`existsSync`) as a cheap local guard alongside the network check. Negative check during implementation: move `## Pitfalls` above `## Pattern` in one seed doc, run the test, see it fail, revert; note the result in the PR.

### 8. Registry (`src/lib/patterns/registry.ts`)

- Imports `manifest` from `./manifest.generated`. At module scope: map each entry through `parsePatternMeta(entry.meta, entry.slug)`, run `validateCollection`, freeze. Export `allPatterns`, `atoms`, `composites` (each sorted by title), `getPattern(slug)`, `getUses(doc)` (resolved docs), `getUsedBy(slug)`.
- Header comment: explicit imports via a generated manifest, never `readdir`, same reasoning as `apps/website/src/lib/blog/posts.ts`; validation at module scope fails the build.
- `src/lib/patterns/mdx.d.ts`: `declare module "*.mdx" { import type { MDXProps } from "mdx/types"; export const frontmatter: unknown; export default function MDXContent(props: MDXProps): JSX.Element; }` (check whether `@types/mdx` already declares the default export; only add `frontmatter`).

### 9. Components and routes

- `src/app/ui/PatternCard.tsx` (server): title link to `/p/<slug>`, summary, tags as small plain labels.
- `src/app/ui/CodeLinks.tsx` (server): `<ul>` of `code` entries; each item a link to `blobUrl(entry)` with the path in monospace, the short SHA (first 7) after it, and `note` below. `rel="noreferrer"`.
- `src/app/ui/Combines.tsx` (server): `<ol>` of the composite's `uses` in frontmatter order, each linking to `/p/<slug>` with that atom's summary.
- `src/app/ui/RelationsPanel.tsx` (server): right-hand `<aside>`: "Combines" (composites) or "Used by" (atoms, from `getUsedBy`, hidden when empty), then "Code" (compact list of paths), `verifiedIn` as links to `https://github.com/SBub/issebya-homes-ai-system/pull/<n>`, and `updated`.
- `src/app/page.tsx`: heading, one-line intro, two columns on `md:` and up (stacked on mobile): "Atoms" and "Composites", each a list of `PatternCard`. Reads only `registry`.
- `src/app/p/[slug]/page.tsx`: `generateStaticParams` from `allPatterns`; `generateMetadata` (title, summary); page awaits `params`, `getPattern`, `notFound()` when missing (no `dynamicParams`, same as the blog). Layout: `lg:` grid with the article (title, kind label, summary, then `<Content components={{ CodeLinks: () => <CodeLinks code={doc.code} />, Combines: () => <Combines uses={getUses(doc)} /> }} />`) and `RelationsPanel` on the right; panel stacks under the title on mobile.
- No `"use client"` anywhere in the app.

### 10. Seed content

Write in house voice: short sentences, no em dashes, no emojis, no bold-only lines. Every code block is either copied from the pinned file or trimmed from it and preceded by a line `Excerpt from <path>, trimmed.`; no invented code. Frontmatter `code[].ref` is the pinned SHA from step 1 for every entry. `verifiedIn` uses the PR numbers the issue lists; confirm each with `gh pr view <n> --json title,files` touches the linked files before listing it. `updated: 2026-09-29` (or the day of implementation).

- `content/server-prefetch-hydration.mdx` (atom; tags e.g. `react-query`, `rsc`, `caching`; verifiedIn `[163]`):
  - Problem: a client list that fetches on mount shows a spinner, then data, and duplicates work the server could do.
  - Mechanism: the server creates a QueryClient from the same factory the client uses, `prefetchInfiniteQuery` with the same key, `dehydrate`, and wraps the client list in `HydrationBoundary`. The client's `useSuspenseInfiniteQuery` finds the key already in its cache. Pending queries are dehydrated too, so the client picks up the in-flight promise. From then on the client query cache owns page one: the server only seeds it, and the client fetches pages 2+ itself. Reconcile the issue's phrase "why the client owns page one" with the code: the doc says the server fetches page one and hands it to the client's cache, which then owns it (never refetches it on mount). Do not claim the browser fetches page one.
  - Pattern: excerpts of `getFirstPageState` (with `"use cache"`, `cacheTag`, `cacheLife`), the `HydrationBoundary` render, `makeShopQueryClient`'s `shouldDehydrateQuery`, and the `useSuspenseInfiniteQuery` call.
  - Pitfalls: the key must be identical on both sides (shared `shopProductsQueryKey`); `Date.now()` inside `dehydrate` fails the prerender outside a cache scope (`next-prerender-current-time`), hence `"use cache"`; `refetchOnMount: false` or the hydrated page is refetched when older than `staleTime`; the plain `useInfiniteQuery` would render an empty pending state instead of suspending; shared client options via one factory.
  - When not to use: data that is never paged or refetched on the client (render it in a Server Component directly); per-user data you cannot put in a shared cache.
  - Code: `ShopProducts.tsx`, `ProductList.tsx`, `src/lib/shop/query-client.ts` (full repo paths).
- `content/suspense-without-flash.mdx` (atom; tags `suspense`, `transitions`, `error-boundary`; verifiedIn `[163, 165, 167, 169, 176]` subject to the `gh` check):
  - Problem: a skeleton that flashes on every sort or search, and layout shift when real content arrives.
  - Mechanism: a component that is not ready throws a promise (a thenable) during render, and React shows the nearest `<Suspense>` fallback until it settles; `use()` is the sanctioned way to read a promise in render (state this as React's mechanism, without claiming the shop calls `use()` on a promise; in `ShopControls` `use` reads a context). The static shell renders everything that does not read the request; only the component that awaits `searchParams` is the hole. An update wrapped in a transition does not replace an already-revealed boundary with its fallback, so the old content stays. `useTransition` when the UI needs `isPending` (grid dimmed, `aria-busy`), bare `startTransition` otherwise (the error boundary's retry). The error boundary sits outside the Suspense hole and inside the controls wrapper.
  - Pattern: excerpts of `page.tsx`'s nested Suspense tree with fallbacks, `ShopControls`' `startTransition(() => router.replace(...))` and the `aria-busy` wrapper, `ShopGridBoundary`'s retry.
  - Pitfalls: a fallback not sized like the content causes a jump (`ShopControlsFallback`, `ProductGridSkeleton count={SHOP_PAGE_SIZE}`); reading `searchParams` or cookies above the boundary makes the whole page dynamic; retrying a server error needs `router.refresh()` as well as `resetError()`, plus `useQueryErrorResetBoundary` for the client query; next-page errors never reach the boundary in suspense mode.
  - When not to use: content that is static anyway; first load where showing the skeleton is right (transitions only help after a boundary has revealed).
  - Code: `shop/page.tsx`, `ShopControls.tsx`, `ShopGridBoundary.tsx`.
- `content/infinite-scrolling.mdx` (composite; `uses: [server-prefetch-hydration, suspense-without-flash]`; tags `pagination`, `intersection-observer`; verifiedIn `[163, 165, 167]` subject to the `gh` check):
  - Problem, Mechanism (page one from the server, pages 2+ from an API route; keyset cursor on `(createdAt, slug)` in sort order, opaque base64url carrying sort and `q`; a sentinel observed with `rootMargin: "400px 0px"`; a "Load more" button always present while there is a next page as the non-JS/fallback path; a retry line for next-page errors), `## Combines` + `<Combines />`, Pattern (excerpts: `selectPage`, `encodeCursor`/`decodeCursor` signatures, the route's cursor check outside the cache, the `sentinelRef` callback ref, the button), Pitfalls (offset pagination duplicates or skips on insert; a tie-breaker is required for a total order; decoding inside `"use cache"` loses the error class, so decode in the route first; `nextCursor` null at the exact end; re-arm the observer only when `canLoadMore` changes; put sort and search in the query key so a change starts a fresh page one), When not to use (small fixed lists; content people need to reach the footer of or deep-link into a page of).
  - Code: `src/lib/shop/pagination.ts`, `ProductList.tsx`, `src/app/api/shop/products/route.ts`.
- Run `yarn workspace patterns index` to write `content/INDEX.md` and `manifest.generated.ts`; run prettier over `apps/patterns`.

### 11. Link check script

- `scripts/check-code-links.ts`: `readContent()`, then for every `code` entry `fetch(rawUrl(entry), { method: "GET" })`, print `200 <path>@<short sha>` or the failing status, exit 1 on any non-200. Not a unit test (network). Run it: `yarn workspace patterns check-links`; paste the output in the PR.

### 12. Documentation

- `apps/patterns/README.md`: what it is, the two readers, how to run (`yarn workspace patterns dev`, port 3004, honours `PORT`), how to add a doc (create `content/<slug>.mdx` with the frontmatter and section skeleton, run `yarn workspace patterns index`, commit both generated files), the frontmatter fields, the section order, highlighting via `rehype-pretty-code` + `shiki`, the link check, and Deployment (Vercel project `ihas-patterns`, Root Directory `apps/patterns`, `ignoreCommand`, affected-projects setting, no env vars).
- `apps/patterns/AGENTS.md`: behavioural rules only: pin `code.ref` to a SHA on the remote, never a branch; every claim checked against the pinned file, excerpts marked; never hand-edit `INDEX.md` or `manifest.generated.ts`; never import `read-content.ts` from a route; `## Code` and `## Combines` contain only their component tag; copy rules; plugins in `next.config.ts` must stay by string name.
- `apps/patterns/CLAUDE.md`: `@AGENTS.md`.
- Root `AGENTS.md` Ports section: one line that `apps/patterns` defaults to 3004, honours `PORT`, is not behind the webhook gateway.
- Root `README.md`: short `### apps/patterns` entry.
- `docs/conditional-docs.md`: new `## apps/patterns` section (before `## Cross-cutting constraints`): `apps/patterns/AGENTS.md` always for changes under the app; `apps/patterns/README.md` when adding or editing a pattern doc; and `apps/patterns/content/INDEX.md` with condition "When planning UI data flow, Suspense, caching, pagination or forms in any Next app in this repo".

### 13. Visual check

- Build and `yarn workspace patterns start` (PORT 3004 or a free port), screenshot `/` and each of the three `/p/<slug>` pages at 1280 and 390 px with Playwright MCP; attach to the PR. Confirm no horizontal page scroll at 390 px (code blocks scroll inside their `pre`).

### 14. PR notes

- PR body must state the owner steps: create Vercel project `ihas-patterns`, Root Directory `apps/patterns`, framework Next.js, enable "skip deployments when there are no changes to the root directory and its dependencies", no env vars. Until then there is no deployment. Follow-up after creation: add `ihas-patterns` to `PROJECTS` in `scripts/vercel-prune-previews.ts`.
- Paste the link-check output, the build route table, and the negative section-order test result.

### 15. Run the Validation Commands

## Testing Strategy

### Unit Tests

All in the vitest node pool (`*.unit.test.ts` under `apps/patterns/src/lib/patterns/__tests__/`), run by `turbo run test`:

- `schema.unit.test.ts` - frontmatter contract and cross-doc rules.
- `sections.unit.test.ts` - heading extraction and fixed order, auto-rendered sections contain only their tag.
- `links.unit.test.ts` - exact GitHub blob and raw URLs.
- `generated.unit.test.ts` - `INDEX.md` and the manifest match the content directory.
- `content.unit.test.ts` - every real doc parses, validates, has the right sections, and every `code.path` exists locally.

### Test Coverage

- `schema.unit.test.ts` (`*.unit.test.ts`): catches a `code.ref` that is a branch or short SHA, and a composite whose `uses` names a missing doc. Nothing exists today; fails without the schema.
- `sections.unit.test.ts` (`*.unit.test.ts`): catches a doc with sections out of order or hand-written links under `## Code`.
- `content.unit.test.ts` (`*.unit.test.ts`): catches a real content file that breaks the contract before `next build` does, with a readable message.
- `generated.unit.test.ts` (`*.unit.test.ts`): catches a doc added or edited without regenerating `INDEX.md` and the manifest (which would also leave the doc unrouted).
- `links.unit.test.ts` (`*.unit.test.ts`): catches a malformed GitHub URL.
- No `*.browser.test.tsx`: every component is a server component rendering static markup with no events, focus or client state; the unit tests plus the build and the screenshots cover it, and adding a browser pool to a new app costs a Playwright install in CI for nothing.
- No `apps/website/e2e/*.spec.ts`: the feature does not touch `apps/website`, and that Playwright config serves only the website. A new app-level Playwright setup for three static pages is not proportionate; `next build`'s prerender (every route rendered at build time, failing the build on a render error) plus screenshots is the integration check. No `e2e/*.md` journey either.
- The network link check is a script, not a test, so `test` stays offline and deterministic.

### Edge Cases

- `code.ref` as `develop`, a 7-char SHA, uppercase hex, or 40 chars with a non-hex letter: rejected.
- `code.path` with a leading `/`, `..`, or a URL: rejected.
- Composite with empty `uses`, a `uses` pointing at itself, at a missing slug, or at another composite: rejected.
- Atom with `uses`: rejected.
- Summary with two sentences or an em dash: rejected.
- `updated` like `2026-02-31`: rejected.
- `## Heading` inside a fenced code block: ignored by the section check.
- An H3 inside a section: allowed (only H2 order is contracted).
- Paths with `(main)` and `[slug]` segments: URLs still resolve (link check).
- Unknown `/p/<slug>`: 404 via `notFound()`.
- An atom used by no composite: "Used by" block hidden, not empty.

## Acceptance Criteria

- `apps/patterns` exists with `package.json`, Next 16 + `@next/mdx`, TypeScript, Tailwind v4, ESLint, Prettier, Vitest; `dev` runs `next dev` on `PORT` defaulting to 3004.
- `pyproject.toml` excludes `apps/patterns`; `uv sync` succeeds.
- `apps/patterns/vercel.json` has the same `ignoreCommand` as the website.
- `README.md`, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md` only) exist in `apps/patterns`; root `AGENTS.md` names port 3004; root README lists the app.
- Three seed docs exist with valid frontmatter, the fixed section order, `code` entries pinned to a 40-char SHA on the remote, and only real (excerpted) code.
- An invalid frontmatter fails `next build` (module-scope `parse` in the registry) and the unit tests.
- `content/INDEX.md` and `manifest.generated.ts` are generated in `prebuild`, checked in, and a test fails when they are stale.
- `docs/conditional-docs.md` has the `apps/patterns/content/INDEX.md` entry with the specified condition.
- `/` shows atoms and composites in two columns (stacked on mobile) with summaries and tags; `/p/[slug]` renders the doc with syntax-highlighted code, the Combines/Used by panel and the Code links to `github.com/SBub/issebya-homes-ai-system/blob/<sha>/<path>`.
- The build route table lists `/` and `/p/[slug]` (three paths) as prerendered (static or SSG); no `"use client"` in the app.
- `yarn workspace patterns check-links` prints 200 for every entry.
- Lint, typecheck, test, build, knip and prettier are green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn install` - Lockfile includes the new workspace
- `uv sync` - Python workspace still resolves with the new Node app excluded
- `yarn workspace patterns index && git diff --exit-code apps/patterns/content/INDEX.md apps/patterns/src/lib/patterns/manifest.generated.ts` - Generated files are current
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/patterns` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/patterns` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/patterns` - Unit tests pass (schema, sections, links, generated files, real content)
- `yarn turbo run build --filter=./apps/patterns` - Production build succeeds; the route table shows `/` and `/p/[slug]` prerendered
- `yarn workspace patterns check-links` - Every `code` link returns 200 from raw.githubusercontent.com
- `yarn turbo run lint typecheck test --filter=./apps/website` - The website is unaffected

## Notes

- New dependencies (all in `apps/patterns`): `next`, `react`, `react-dom`, `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `zod`, `yaml` (node-side frontmatter parse), `remark-frontmatter` + `remark-mdx-frontmatter` (expose YAML frontmatter as a `frontmatter` export in the bundle), `rehype-pretty-code` + `shiki` (build-time syntax highlighting, the choice the issue asked to state), plus dev tooling mirroring the website.
- Why YAML instead of the blog's `export const meta`: agents read the files from disk, and the index generator and tests must read frontmatter without compiling MDX. The Turbopack restriction the blog cites only forbids non-serialisable plugins; string names with JSON options work.
- If `remark-mdx-frontmatter` or `rehype-pretty-code` misbehaves under Turbopack by string name, fall back to `next build --webpack` in this app only and document why in `apps/patterns/README.md`; do not import plugin functions into `next.config.ts` under Turbopack.
- The generated `INDEX.md` line format (`- [title](content/slug.mdx) — read when: <summary>`) contains an em dash because the issue fixes that format to match `docs/conditional-docs.md`; it is machine-read index syntax, not prose. If the owner wants the copy rule applied there too, change `renderIndexMd` and regenerate.
- The issue's phrase "why the client owns page one" is resolved against the code: the server fetches page one and seeds the client's query cache, which then owns it. The doc must say that, not that the browser fetches page one.
- `use()` is described as React's mechanism for reading a promise in render. The shop does not call `use()` on a promise (it uses it for context in `ShopControls`), so the doc must not link it as proof of that.
- `scripts/vercel-prune-previews.ts` is not changed in this PR; add `ihas-patterns` to `PROJECTS` once the owner creates the project.
- The issue lists `/document` behaviour; the documentation phase should add this feature's `app_docs` entry under the new `## apps/patterns` section rather than the website's.
- Out of scope: more seed docs, search, any agent API beyond files on disk, deploying.
