# Agent instructions

## Documentation convention

Every workspace (this root, each `apps/*`, each `packages/*`) follows the
same four-file pattern, each file with one job:

- `README.md` - what the project is and how to use it. Human-facing.
- `ENGINEERING.md` - deep technical walkthrough. Only exists where there's
  real depth to document; not every workspace needs one. When it exists,
  the workspace's own `README.md` links to it.
- `AGENTS.md` - rules for an agent working in this codebase: conventions,
  gotchas, things that aren't obvious from reading the code.
- `CLAUDE.md` - just `@AGENTS.md`, nothing else. Claude Code reads
  `CLAUDE.md` by default, not `AGENTS.md`; this makes it pick up the same
  rules any other agent/tool would read from `AGENTS.md`, with a single
  source of truth instead of two files drifting apart.

Don't add project-specific reference material (architecture notes, env var
tables, deploy steps) to `AGENTS.md` or `CLAUDE.md`. That belongs in
`README.md` or `ENGINEERING.md`. `AGENTS.md` is for behavioral rules only.

## Repo-wide conventions

- Yarn only (Berry, pinned via `packageManager` in `package.json` +
  corepack), never npm or npx.
- Conventional-commit messages. No `Co-Authored-By` trailer.
- lefthook runs on every commit (format, lint, typecheck, knip on staged
  files) and every push (tests). Hooks install automatically via
  `postinstall` on `yarn install`, no manual step.
- Workspaces live under `apps/*` and `packages/*`, orchestrated by Turborepo.
