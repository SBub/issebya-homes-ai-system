# Agent rules for apps/patterns

- Pin every `code[].ref` to a full 40-character commit SHA that exists on the
  remote (`git ls-remote origin <branch>`), never a branch name. A branch link
  drifts; a SHA does not.
- Check every claim in a doc against the file at its pinned SHA. The `code[]`
  links are the proof that the pattern survives production; the snippets in
  `## Pattern` are not copies of those files.
- Snippets under `## Pattern` are written for the page, in the react.dev
  teaching style. Together they are a working mini app of two or three
  files that a reader can paste into a fresh Next app and run. One example
  grows across the section and its identifiers never change between steps.
  Names are domain-neutral and platform-real (`steps`, `events`,
  `EventSource`, `ReadableStream`), on Next App Router paths (`app/...`):
  no repo constants, no product nouns, no `demo` nouns. Only platform APIs
  and `next/...` or `react` when unavoidable; no TypeScript annotations
  beyond what `strict` needs, no styling, no aria, no casts, no app-module
  imports. Comment only the line that is the point. Prose rhythm: one
  sentence before the snippet, the snippet, one or two sentences after
  saying what is now true.
- Every code snippet carries the filename it belongs to, as the fence meta
  ` ```ts title="app/api/progress/route.ts" `, rendered above the
  block like react.dev's sandbox file tabs. The path makes server or client
  obvious (`app/api/.../route.ts` versus `app/View.tsx`). A `text` fence is
  wire output, not code, and carries no title. A unit test fails when a doc
  that labels one Pattern fence leaves another code fence unlabelled.
- Every snippet is complete and runnable exactly as shown. No placeholders,
  no free variables, no `// ...` stubs hiding required lines. A route that
  needs a source of events includes a tiny in-file one (an array of steps
  on a timer). A client component is a full file: `"use client"`, imports,
  state, render. Include the `app/page.tsx` that mounts it so the set is
  self-contained. Keep each file as short as completeness allows (a route
  around 40 lines); completeness wins over brevity when they conflict.
- Never label a snippet `Excerpt from <path>, trimmed.` Instead, `## Pattern`
  ends with an `### In this repo` list that maps each piece to a linked file
  at the same SHA as its `code[]` entry, in prose only, no code fences. Those
  are the only hand-written code links allowed outside frontmatter.
- Pitfalls are symptom-first ("EventSource reconnects forever after the
  stream ends"), and where code exists they come as a wrong/right pair
  marked 🔴 / ✅ under `### Wrong and right`, 5 to 10 lines each. Each half
  is a complete file or a fragment of one of the named files, with the same
  `title="..."` label and a sentence saying where in that file it sits.
  Those two markers are the one exception to the no-emojis rule below.
- `verifiedIn` lists pull request numbers, not issue numbers. Confirm each
  with `gh pr view <n> --json files` touches the linked files.
- Never hand-edit `content/INDEX.md` or `src/lib/patterns/manifest.generated.ts`.
  Run `yarn workspace patterns index` and commit both.
- Never import `src/lib/patterns/read-content.ts` from a route or component.
  It reads the disk; routes go through `registry.ts`.
- `## Code` contains only `<CodeLinks />` and `## Combines` only
  `<Combines />`. Links to code come from frontmatter, not prose, except the
  `### In this repo` list.
- Doc prose follows the house copy rules: short sentences, no em dashes, no
  emojis (other than the 🔴 / ✅ pair markers). The em dash in `INDEX.md`
  lines is index syntax, generated.
- MDX plugins in `next.config.ts` stay by string name with JSON options.
  Importing a plugin function breaks the Turbopack build.
- Client components only for live demos: one file per demo under
  `src/app/demos/`, imported from the doc's MDX. Every page must still
  prerender, so a demo never reads the request on the server and fetches only
  from `src/app/api/demo/*`.
- Demo routes under `src/app/api/demo/` take no env vars and touch no
  database.
- Never add `export const dynamic` to a route. It is rejected under
  `cacheComponents`; reading the request already makes a handler dynamic.
- Agent harness demos (the `agent-harness` tag) run on the shared fake runtime
  under `src/lib/harness/`: a scripted model, an in-memory durable step runner
  and a Map-backed table. The step runner must keep modelling memoization,
  replay from the top and the no-step-inside-a-step rule honestly, or the
  approval and trace demos teach the wrong thing. Never import from
  `apps/guest-communication-agent`; snippets are copied and simplified, and the
  pinned `code[]` links are the proof.
