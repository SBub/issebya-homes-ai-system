# Agent rules for apps/patterns

- Pin every `code[].ref` to a full 40-character commit SHA that exists on the
  remote (`git ls-remote origin <branch>`), never a branch name. A branch link
  drifts; a SHA does not.
- Check every claim in a doc against the file at its pinned SHA. Code blocks
  are copied or trimmed from those files, never invented, and each is preceded
  by a line `Excerpt from <path>, trimmed.`
- `verifiedIn` lists pull request numbers, not issue numbers. Confirm each
  with `gh pr view <n> --json files` touches the linked files.
- Never hand-edit `content/INDEX.md` or `src/lib/patterns/manifest.generated.ts`.
  Run `yarn workspace patterns index` and commit both.
- Never import `src/lib/patterns/read-content.ts` from a route or component.
  It reads the disk; routes go through `registry.ts`.
- `## Code` contains only `<CodeLinks />` and `## Combines` only
  `<Combines />`. Links to code come from frontmatter, not prose.
- Doc prose follows the house copy rules: short sentences, no em dashes, no
  emojis. The em dash in `INDEX.md` lines is index syntax, generated.
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
