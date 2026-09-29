# Patterns library app

**ADW ID:** 066a1da6
**Date:** 2026-09-29
**Specification:** specs/issue-189-adw-066a1da6-sdlc_planner-patterns-library-app.md

## Overview

A new Next 16 workspace, `apps/patterns`, that turns the React/Next patterns proven in the shop work into a small, fully prerendered documentation site. Each pattern is one MDX file with validated YAML frontmatter, a fixed section order and code links pinned to a commit SHA. The same files serve the owner in a browser and coding agents reading from disk through a generated `content/INDEX.md`.

## What Was Built

- Workspace scaffold copied and trimmed from `apps/website` (Next 16, `@next/mdx`, Tailwind v4, ESLint, Prettier, Vitest node pool), without Sentry, Supabase, PostHog or a browser test pool
- A Zod frontmatter contract (`kind` atom or composite, one-sentence `summary`, `uses`, `code` entries pinned to a 40-char SHA, `verifiedIn` PR numbers, calendar-day `updated`) plus cross-doc validation
- A fixed H2 section order per kind, with `## Combines` and `## Code` rendered from frontmatter by `<Combines />` and `<CodeLinks />`
- A generator (`yarn workspace patterns index`, run in `prebuild`) that writes `content/INDEX.md` and `src/lib/patterns/manifest.generated.ts`
- A registry that validates every doc at module scope, so a bad doc fails `next build`
- Two routes: `/` (atoms and composites in two columns) and `/p/[slug]` (the doc with a Combines / Used by / Code / Verified in side panel)
- Build-time syntax highlighting with `rehype-pretty-code` + `shiki`
- A network link check script (`yarn workspace patterns check-links`)
- Three seed docs written against the shop code at `a1410c6`: `server-prefetch-hydration` (atom), `suspense-without-flash` (atom), `infinite-scrolling` (composite)
- Repo wiring: `pyproject.toml` uv exclude, `knip.json` workspace block, `vercel.json` with the shared `ignoreCommand`, root README and AGENTS port line, `docs/conditional-docs.md` section

## Technical Implementation

### Files Modified

- `apps/patterns/package.json`: scripts (`dev`/`start` on `${PORT:-3004}`, `prebuild` → `index`, `check-links`) and dependencies
- `apps/patterns/next.config.ts`: `cacheComponents`, `createMDX` with remark/rehype plugins passed by string name
- `apps/patterns/src/lib/patterns/schema.ts`: frontmatter schema, `parsePatternMeta`, `validateCollection`, `usedBy`
- `apps/patterns/src/lib/patterns/sections.ts`: H2 extraction (ignores fenced code) and the per-kind order check
- `apps/patterns/src/lib/patterns/links.ts`: GitHub blob and raw URL builders
- `apps/patterns/src/lib/patterns/index-md.ts`, `manifest-source.ts`: pure renderers for the two generated files
- `apps/patterns/src/lib/patterns/read-content.ts`: node-only disk reader for scripts and tests, never imported by a route
- `apps/patterns/src/lib/patterns/registry.ts`: module-scope validation, `allPatterns`/`atoms`/`composites`, `getPattern`, `getUses`, `getUsedBy`
- `apps/patterns/src/app/page.tsx`, `src/app/p/[slug]/page.tsx`: the two routes
- `apps/patterns/src/app/ui/*`: `PatternCard`, `CodeLinks`, `Combines`, `RelationsPanel` (all server components)
- `apps/patterns/src/mdx-components.tsx`: typography mapping; prose, list items and inline code wrap long paths with `[overflow-wrap:anywhere]`
- `apps/patterns/scripts/build-index.ts`, `scripts/check-code-links.ts`: generator and link check
- `apps/patterns/content/*.mdx`, `content/INDEX.md`: seed docs and the generated index
- `pyproject.toml`, `knip.json`, `AGENTS.md`, `README.md`, `docs/conditional-docs.md`: repo wiring

### Key Changes

- **YAML frontmatter, two readers of it.** In the bundle `remark-frontmatter` + `remark-mdx-frontmatter` expose it as a `frontmatter` export; on the node side `read-content.ts` parses it with `yaml`. Both run the same Zod schema, so agents and tools read frontmatter without an MDX compiler.
- **No runtime `readdir` in routes.** The generator writes explicit imports into `manifest.generated.ts`; the registry imports that, the same approach as the website's blog registry. `generated.unit.test.ts` fails when either generated file is stale.
- **Auto-rendered sections.** `## Combines` and `## Code` hold only their component tag. The page passes those components bound to the current doc through the MDX `components` prop, and the section check rejects any hand-written content there.
- **Turbopack constraint.** MDX plugins are passed by string name with JSON options; importing plugin functions into `next.config.ts` breaks the Turbopack build.
- **Mobile overflow fix (review patch).** Repo paths in "Excerpt from ..." lines had no break opportunity and widened the page at 375 to 390 px. `p`, `li` and inline `code` now use `[overflow-wrap:anywhere]`; highlighted code blocks still scroll inside their own `pre`.

## How to Use

1. Run `yarn workspace patterns dev` and open http://localhost:3004 (or the `PORT` you set).
2. To add a doc, create `content/<slug>.mdx` with the frontmatter and the section skeleton for its kind (see `apps/patterns/README.md`).
3. Run `yarn workspace patterns index` to validate every doc and regenerate `content/INDEX.md` and the manifest.
4. Commit the doc and both generated files.
5. Run `yarn workspace patterns check-links` to confirm every pinned code link returns 200 on GitHub.

Agents skip the browser: read `apps/patterns/content/INDEX.md`, then the matching `content/<slug>.mdx`.

## Configuration

- Port: defaults to 3004, honours `PORT`; not behind the webhook gateway.
- No environment variables.
- Not deployed yet. Planned Vercel project `ihas-patterns`, Root Directory `apps/patterns`. Once it exists, add it to `PROJECTS` in `scripts/vercel-prune-previews.ts`.

## Testing

- `yarn turbo run test --filter=./apps/patterns`: unit tests for the schema, section order, link builders, generated-file freshness and every real content doc (frontmatter, sections, `code.path` exists locally).
- `yarn turbo run build --filter=./apps/patterns`: prerenders `/` and every `/p/<slug>`; an invalid doc fails the build.
- `yarn workspace patterns check-links`: network check, kept out of `test` so tests stay offline.
- Filter by path (`./apps/patterns`), as the repo root `AGENTS.md` describes for turbo filters.

## Notes

- The `— read when:` em dash in generated `INDEX.md` lines is deliberate machine-read index syntax matching `docs/conditional-docs.md`; doc prose follows the no-em-dash rule, which the schema enforces for `summary`.
- The seed docs say the server fetches page one and seeds the client's query cache, which then owns it; they do not claim the browser fetches page one. `use()` is described as React's mechanism, not linked as something the shop calls on a promise.
- Composites may only combine atoms for now (`validateCollection` rejects a composite in `uses`).
- Out of scope: more seed docs, search, any agent API beyond files on disk, deploying.
