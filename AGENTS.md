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

## Finding the right documentation

Before planning or implementing, read `docs/conditional-docs.md`. It indexes every
reference document in the repo by _when to read it_, so you read the two or three
that apply to your task instead of everything or nothing. Always read the target
workspace's own `AGENTS.md` as well.

When you add documentation, add an entry for it there.

## Environment files

- Root `.env.development` holds AI Developer Workflow (ADW) configuration only.
- Each workspace's own `.env.development` / `.env.production` holds that
  application's environment.
- `.env.development` is local, `.env.production` is production. Never put a local
  value in `.env.production`.

## Ports

`apps/telegram-router` (3003) and `apps/guest-communication-agent` (3005) are
pinned by an external contract: one reserved ngrok hostname fronts
`scripts/dev-webhook-gateway.ts` on 3010, which routes by path prefix to them
(and to the ADW trigger on 8001), and Twilio and Telegram hold registered URLs
against it. Never move those two ports, and never start a second dev server for
either webhook app.

`apps/website` has no such contract — the gateway has no route to it. It honours
`PORT` and only defaults to 3000, which is what lets an ADW run give each
worktree its own server instead of testing whatever is already on 3000. Don't
hardcode a port there, and don't assume 3000 is the one under test.

The repository runs a single shared local Supabase instance. Never reset it as
part of a task.

## Python workspaces

Python apps are uv workspace members under `apps/*`, declared via a
`pyproject.toml` in the app directory. The root `pyproject.toml` is a virtual
workspace root (no `[project]` table of its own) — it only declares
`[tool.uv.workspace]` membership and a `[tool.turbo].name` that doesn't
collide with anything.

They are linted and typechecked with ruff/mypy, not eslint/tsc.

`uv` auto-registers `build`/`test`/`lint`/`check`/`format` turbo tasks for a
Python workspace member; it does **not** register `dev`, `start`,
`typecheck`, or `format:check` — those are this repo's own task vocabulary.
A Python app therefore keeps a thin `package.json` declaring only those four
scripts, each shelling out to `uv run`.

IMPORTANT: that thin `package.json`'s `"name"` must differ from the app's own
`[project].name` in its `pyproject.toml` — reusing the same name for both
collides (uv/turbo refuse to register two workspace members at the same path
under one name). Suffixing the `package.json` name (e.g. `<app-name>-tasks`)
avoids this.

The root `.python-version` pins the interpreter for the whole workspace; an
individual app's own `pyproject.toml` still declares its own
`requires-python`.
