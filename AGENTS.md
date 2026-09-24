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

## Python workspaces

The repo root is a virtual [uv](https://docs.astral.sh/uv/) workspace
(`pyproject.toml`, `.python-version`, `uv.lock`), and turbo's
`experimentalPythonWorkspaces` future flag is on. A Python app is a uv
workspace member under `apps/*` with its own `pyproject.toml`.

- A Python member must declare `ruff`, `mypy`, and `pytest` in its
  `[dependency-groups] dev` list. Turbo only synthesizes a `lint` task when
  `ruff` is present and a `test` task when `pytest` is present — omit either
  and that member silently drops out of the corresponding gate with no
  error.
- The member's thin `package.json` carries only the scripts turbo does
  _not_ synthesize for a uv package: `dev`/`start`/`typecheck`/`format:check`.
  Don't add `lint` or `test` scripts there; turbo already provides them from
  the dev group.
- That thin `package.json`'s `"name"` must differ from the app's
  `[project].name` in its `pyproject.toml` — turbo (not uv) refuses to run
  if they match. Convention: suffix the package.json name with `-tasks`.
- Consequence: once a Python app lands, two turbo packages exist at one
  directory, and the task set divides between them. `--filter=<app-name>`
  resolves only the `pyproject.toml` package, so e.g.
  `turbo run typecheck --filter=probe-svc` reports `No tasks were executed`
  and exits 0 even with a live type error. Filter by path instead:
  `--filter=./apps/<dir>`.
- A Python app's thin `package.json` is still a yarn workspace, so it needs
  a `yarn.lock` entry — run `yarn install` after adding it, or every yarn
  command on it fails with `This package doesn't seem to be present in your
lockfile`.
- Every new **Node** app added under `apps/` or `packages/` must also be
  added to the root `pyproject.toml`'s `[tool.uv.workspace] exclude` list,
  or `uv sync` breaks (`missing a pyproject.toml`). This is dormant with
  zero Python members and springs later, on an unrelated PR.
- A turbo warning — `Unable to resolve uv.lock; using conservative Python
task hashing. failed to parse 'uv workspace metadata' output: missing
field 'members'` — is expected and non-fatal while there are zero Python
  workspace members; uv omits `members` from its own workspace-metadata
  output when the workspace has none. It disappears once the first real
  Python app exists. Its own remediation text ("run `uv lock` and commit
  uv.lock") is wrong in this state — the lockfile is already committed.
- A Python app deployed to Vercel needs a `vercel.json` in its own directory
  that sets `installCommand` to `uv sync --frozen --no-dev --no-editable
--package <name>` and `buildCommand` to a smoke import of the entrypoint
  module. Without it, Vercel's turbo detection sets Install Command to
  `yarn install`, the Python builder treats that custom command as "deps
  already installed" and skips `uv sync`, and the function ships with no
  packages: a green build, then `ModuleNotFoundError` on every request. See
  `apps/telegram-router/README.md`'s Deployment section. After any deploy of
  a Python app, hit its `/api/health` before calling it done.
- Do **not** add a `required-version` floor under `[tool.uv]` in the root
  `pyproject.toml`. It gates every `uv` invocation, including the one inside
  Vercel's build image — which ships its own uv (0.10.11 at the time of
  writing) and cannot be pinned from here, so a floor above it fails the
  deployment outright with `Required uv version >=X does not match the running
version`. Pin uv where it can actually be pinned: CI passes an explicit
  `version:` to `astral-sh/setup-uv`. Note that turbo's Python task caching
  wants a uv new enough for `uv workspace metadata --frozen`, which 0.10.11 is
  not — so Vercel builds fall back to conservative Python hashing. That is a
  warning, not an error, and not worth breaking the deploy over.
- Every Vercel project's `vercel.json` sets `ignoreCommand` to
  `bash ../../scripts/vercel-ignore.sh`, and a new app's `vercel.json` must
  carry the same line. On a branch whose name contains `-adw-`, only a commit
  whose message has a line starting with `Deploy-Preview: yes` builds a
  preview; every other commit on that branch is skipped (Canceled).
  Production, `develop`, `master` and hand-made branches build as before. The
  ADW toolkit's document phase adds that trailer to the run's final commit;
  the string is a shared contract with the toolkit's `git_ops.PREVIEW_TRAILER`,
  so never change it on one side only. To force a preview by hand:
  `git commit --allow-empty -m "chore: preview" -m "Deploy-Preview: yes"`.
  Keep each project's dashboard Ignored Build Step on "Automatic"; a dashboard
  script would be overridden by `vercel.json` anyway.

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
