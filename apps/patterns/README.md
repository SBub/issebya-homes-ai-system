# apps/patterns

A pattern library for this repo: one short MDX doc per React/Next pattern the
codebase already runs, each with its mechanism, short teaching snippets
written for the page, its pitfalls and links to the files that prove it,
pinned to a commit.

An **atom** is a single technique. A **composite** combines atoms and names
them in `uses`.

It has two readers:

- the owner, in a browser: `/` lists atoms and composites; `/p/<slug>` renders
  one doc with a Combines / Used by side panel and the code links;
- coding agents, from disk: the raw `content/*.mdx` files and the generated
  `content/INDEX.md`, which `docs/conditional-docs.md` points at.

Every page is prerendered at build time. The only client components are live
demos under `src/app/demos/`, rendered as islands inside a prerendered doc.

## Run

```sh
yarn workspace patterns dev     # http://localhost:3004, honours PORT
yarn workspace patterns build   # runs `index` first (prebuild)
yarn workspace patterns test    # unit (node) and browser (chromium) tests
```

## Add a doc

1. Create `content/<slug>.mdx` with the frontmatter below and the section
   skeleton for its kind.
2. Run `yarn workspace patterns index`. It validates every doc and rewrites
   `content/INDEX.md` and `src/lib/patterns/manifest.generated.ts`.
3. Commit the doc and both generated files. A unit test fails when either
   generated file is stale, and a doc missing from the manifest has no route.
4. Run `yarn workspace patterns check-links` (network) to confirm every code
   link resolves on GitHub.

### Frontmatter

```yaml
title: Server prefetch with hydration # 1..80 characters
kind: atom # or composite
summary: One sentence, ending with a period, no em dash. # the "read when" line
tags: [react-query, rsc] # kebab-case, at least one
uses: [an-atom, another-atom] # composites only, required there; atoms only
code: # at least one
  - path: apps/website/src/lib/shop/query-client.ts # repo-relative
    ref: a1410c6b3afa1ac500fc7018ca1ad42d5956e3b0 # full 40-char commit SHA
    note: What this file proves. # 1..160 characters
verifiedIn: [164] # PR numbers
updated: 2026-09-29 # calendar day
```

The schema is `src/lib/patterns/schema.ts`. The registry validates every doc
at module scope, so an invalid doc fails `next build` as well as the tests.

### Sections

Every doc has exactly these H2 sections, in this order:

- atom: Problem, Mechanism, Pattern, Pitfalls, When not to use, Code
- composite: Problem, Mechanism, Combines, Pattern, Pitfalls, When not to use, Code

`## Combines` contains only `<Combines />` and `## Code` only `<CodeLinks />`;
the page renders both from frontmatter. H3s inside a section are fine.

`## Pattern` holds snippets written for the page in the react.dev teaching
style: a working mini app of two or three complete files, each fence labelled
with its filename (` ```ts title="app/api/progress/route.ts" `, shown
as a tab above the block), followed by an `### In this repo` list that maps
each piece to the pinned file. The `code:` links are the proof that the
simple version survives production. `AGENTS.md` has the full rules.

## How it works

- **Frontmatter** is YAML so that agents and node-side tools can read it
  without an MDX compiler. In the bundle, `remark-frontmatter` +
  `remark-mdx-frontmatter` expose it as a `frontmatter` export; on the node
  side `read-content.ts` parses it with `yaml`. Both go through the same Zod
  schema.
- **Registry**: `registry.ts` imports the generated manifest (explicit
  imports, never a `readdir`), validates it and resolves `uses` and the
  reverse "used by" edges. `read-content.ts` reads the disk and is only for
  the scripts and tests.
- **Highlighting**: `rehype-pretty-code` with its `shiki` peer, at build
  time, so highlighted code is static HTML with no client JavaScript. A
  fence's `title="..."` meta becomes a `<figcaption>` that `globals.css`
  styles as a file tab.
- Plugins are passed to `createMDX` by string name, the only form Turbopack
  accepts.
- **Demo route**: `src/app/api/demo/progress` is the one dynamic route. It
  streams Server-Sent Events for the `sse-route-handler` demo and uses no env
  vars and no database.

## Deployment

Not deployed yet. The intended setup is a Vercel project `ihas-patterns` with
Root Directory `apps/patterns`, framework Next.js, "skip deployments when
there are no changes to the root directory and its dependencies" on, and no
environment variables. `vercel.json` carries the repo's shared
`ignoreCommand`. Once the project exists, add it to `PROJECTS` in
`scripts/vercel-prune-previews.ts`.
