# Chore: Teach the monorepo Python — turbo uv workspaces + ruff/mypy/pytest toolchain

## Metadata

issue_number: `69`
adw_id: `7fa80e5f`
issue_json: `{"number":69,"title":"Teach the monorepo Python: turbo uv workspaces + ruff/mypy/pytest toolchain","body":"See original GitHub issue #69 for full body: motivates a Python app (FastAPI port of apps/telegram-router, tracked separately) needing to slot into this Node/yarn/turbo monorepo's quality gates (turbo run lint|typecheck|test, knip.json, lefthook.yml, .github/workflows/ci.yml, ADW classify_app) without silently dropping out of coverage. Proposes: bump turbo to 2.10.13 to get experimentalPythonWorkspaces; enable that future flag; add a root pyproject.toml + uv.lock as a uv workspace over apps/*, packages/*; close the dev/start/typecheck/format:check task-name gap with a thin per-Python-app package.json; wire lefthook, .prettierignore, knip, CI, and ADW's classify_app for the mixed toolchain; document the convention. Zero application code touched — groundwork only, verified independently before the real FastAPI port issue lands."}`

## Chore Description

This repo is 100% Node/yarn/turbo today. Every quality gate (`turbo run lint|typecheck|test`,
`knip.json`, `lefthook.yml`, `.github/workflows/ci.yml`, and the ADW pipeline's own
`classify_app` command) enumerates workspaces by reading the root `package.json`
`workspaces` globs. A Python app has no `package.json`, so it would silently stop being
covered by any of these gates — not an error, a silent coverage gap.

Turborepo has native (experimental) uv-workspace support as of 2.10.13, behind the
`experimentalPythonWorkspaces` future flag. This chore wires that support into the repo
so that the _next_ time a Python app is added (the FastAPI port of `apps/telegram-router`,
tracked as a separate issue), it drops into every existing gate without anyone having to
debug the toolchain at the same time as the port itself.

**Zero application code changes.** This chore only touches root-level tooling config
(`turbo.json`, `package.json`, `pyproject.toml`, `.gitignore`, `.prettierignore`,
`lefthook.yml`, `.github/workflows/ci.yml`, `AGENTS.md`, `docs/conditional-docs.md`) plus
one file in a _different_ git repository (see the classify_app note below). No file under
`apps/*` or `packages/*` changes. After this chore, every existing gate must behave
identically to before it, since there is still no real Python workspace member — only the
groundwork for one.

### Research findings that change the plan from the issue's literal suggestion

The issue's suggested snippets were sanity-checked against this repo's actual toolchain
(uv 0.8.20 and turbo 2.10.13, both installed locally) in a scratch directory before writing
this plan. Four things needed correction:

1. **The root `pyproject.toml` cannot have a `[project]` table.** The issue's snippet
   implies a root package named the same as `package.json`'s `"name"`
   (`issebya-homes-ai-system`). Testing shows this collides: turbo refuses to run with
   `the uv workspace name "X" collides with the package of the same name`, and this
   happens both when `[tool.turbo] name` equals the JS root's `package.json` name _and_
   when it equals the python root's own `[project].name` (if one is declared). The fix
   verified to work: the root `pyproject.toml` must be a **virtual workspace root** — no
   `[project]` table at all — with only `[tool.uv.workspace]` and `[tool.turbo]`, and
   `[tool.turbo].name` must be a value that collides with nothing (not the JS root's name,
   not any workspace member's name).
2. **`requires-python` cannot be pinned in the root `pyproject.toml`** as the issue
   suggests, because a `[project]` table requires a `name` field the moment it exists
   (`uv` errors: `` `pyproject.toml` is using the `[project]` table, but the required
`project.name` field is not set ``), and adding one reintroduces the collision from
   point 1. The verified fix: pin the interpreter with a root `.python-version` file
   containing `3.13`. `uv sync` then downloads/uses that exact interpreter, and the
   generated `uv.lock` records `requires-python = ">=3.13"` on its own — no `[project]`
   table required. This satisfies the "pin Python 3.13" intent through the standard uv
   idiom for virtual workspaces.
3. **`members = ["apps/*", "packages/*"]` alone breaks `uv sync` today**, because uv
   requires every directory a member glob matches to contain a `pyproject.toml` —
   confirmed by reproducing `error: Workspace member ".../apps/website" is missing a
pyproject.toml (matches: apps/*)`. None of the three existing Next.js apps or the
   pricing package have one. The fix (also uv-native, tested working): add
   `exclude = [...]` listing today's four non-Python directories alongside `members`. A
   new Python app added later under `apps/*` or `packages/*` is picked up automatically
   without editing `exclude` again — only today's non-Python members need listing, once.
4. **`.prettierignore` does not need a `uv.lock`/`*.toml` entry.** Tested directly in this
   repo: `prettier --check .` (the directory-glob form this repo's `yarn lint`/CI actually
   run) silently skips files with an unrecognized extension; it only errors when a `.toml`
   or `.lock` file is named _explicitly_ on the command line, which never happens here.
   Only `*.py` needs adding, for when real Python source lands later.

One more gotcha worth recording for whoever adds the first real Python app (documented in
`AGENTS.md` per Step 6 below, not something to build now): the thin per-app `package.json`
from the issue's item 4 must use a **different** `"name"` than that Python app's own
`[project].name` in its `pyproject.toml` — reusing the same name for both causes the same
kind of collision as point 1 above (reproduced: `Failed to add workspace "X" ... it` — uv
refuses to register two workspace members at the same path under the same name from two
different manifests).

### classify_app.md lives outside this repository

`.claude/commands` is a symlink to `~/Dev/adw-toolkit/commands`, a _separate_ git
repository — this repo's own `.gitignore` excludes `.claude` entirely with the comment
"ADW toolkit — symlinked in from a private repo, never committed here". Editing
`classify_app.md` therefore cannot be part of this chore's diff or PR: there is nothing
for `git status` in this repo to pick up, and nothing this PR's commit could contain. Step
8 below gives the exact edit to make, but it must be applied and committed as a separate
change in the `adw-toolkit` repository, not as part of this chore.

## Relevant Files

Use these files to resolve the chore:

- `package.json` - bump `turbo` devDependency `^2.10.5` → `^2.10.13`.
- `turbo.json` - add `futureFlags.experimentalPythonWorkspaces`; existing `typecheck` and
  `format:check` task definitions already cover the two task names uv doesn't
  auto-register that this repo actually uses (the other two, `dev`/`start`, are also
  already defined with `cache: false, persistent: true`, matching what a future Python
  app's thin `package.json` would need).
- `.gitignore` - add `.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`,
  `.mypy_cache/`.
- `.prettierignore` - add `*.py` (see research note 4 above for why nothing else is
  needed).
- `lefthook.yml` - add `*.py`-scoped `pre-commit` commands (ruff format with
  `stage_fixed: true`, ruff check, mypy) alongside the existing TS-scoped ones, so a
  pure-TypeScript commit still pays nothing for them.
- `knip.json` - no change needed now (see Step 5 below for why).
- `.github/workflows/ci.yml` - add `astral-sh/setup-uv` + `uv sync --frozen` before the
  existing `turbo run`/`knip` steps.
- `AGENTS.md` - add a short section recording the Python-workspace convention (uv
  workspace membership, the thin-`package.json` pattern and its naming-collision gotcha,
  `.python-version` for the interpreter pin) so the next Python app follows it instead of
  reinventing it. `AGENTS.md` is behavioral-rules-only per its own documentation
  convention section, so this belongs here rather than in `README.md`.
- `docs/conditional-docs.md` - add an entry indexing the new `AGENTS.md` section, per its
  own "when you add documentation, add an entry for it here" instruction.
- `README.md` - read for the cross-app picture only; the "Checks" section
  (`yarn lint`/`typecheck`/`knip`/`test`) does not need edits since these commands remain
  unchanged.

### New Files

- `pyproject.toml` (repo root) - virtual uv workspace root: `[tool.turbo]` name,
  `[tool.uv.workspace]` members + exclude. No `[project]` table (research note 1).
- `.python-version` (repo root) - pins the interpreter uv resolves for the workspace to
  `3.13` (research note 2).
- `uv.lock` (repo root) - generated by `uv sync`, committed alongside `pyproject.toml`
  exactly like `yarn.lock` is committed alongside `package.json`.

## Step by Step Tasks

### 1. Bump turbo and enable the future flag

- In `package.json`, change `"turbo": "^2.10.5"` to `"turbo": "^2.10.13"`.
- In `turbo.json`, add a top-level `"futureFlags"` key (alongside the existing
  `"$schema"` and `"tasks"` keys):
  ```json
  "futureFlags": { "experimentalPythonWorkspaces": true }
  ```
- Run `yarn install` to pull turbo 2.10.13 (or newer within the `^2.10.13` range) and
  update `yarn.lock`.
- Do not touch the `env`/`passThroughEnv`/`outputs` keys already present on the `build`
  task — those are the `3ece833` (`.next/**` outputs, `ENABLE_EXPERIMENTAL_COREPACK`) and
  `0a2eaad` (`SENTRY_AUTH_TOKEN` in `env`) fixes; they must survive this bump unchanged.
  Step 9 validates they still take effect after the version bump.

### 2. Add the root uv workspace

- Create `pyproject.toml` at the repo root:
  ```toml
  [tool.turbo]
  name = "issebya-homes-ai-system-py"

  [tool.uv.workspace]
  members = ["apps/*", "packages/*"]
  exclude = [
    "apps/guest-communication-agent",
    "apps/telegram-router",
    "apps/website",
    "packages/pricing",
  ]
  ```
  `[tool.turbo].name` must not equal `package.json`'s `"name"`
  (`issebya-homes-ai-system`) — see research note 1. `exclude` must list every current
  `apps/*`/`packages/*` directory (none of which has a `pyproject.toml` yet); do not add
  a `members` entry per directory instead of a glob, since the glob is what makes a future
  Python app auto-register without another edit here.
- Create `.python-version` at the repo root containing exactly:
  ```
  3.13
  ```
- Run `uv sync` from the repo root. This creates `.venv/` (gitignored, see Step 3) and
  generates `uv.lock`. Confirm `uv.lock` contains `requires-python = ">=3.13"`.
- Commit `pyproject.toml`, `.python-version`, and `uv.lock`.

### 3. Ignore Python tooling artifacts

- In `.gitignore`, add:
  ```
  .venv/
  __pycache__/
  .pytest_cache/
  .ruff_cache/
  .mypy_cache/
  ```
  Add these near the other cache/build entries (`.turbo/`, `.next/`, `coverage/`) rather
  than at the end, to keep the file's existing grouping.

### 4. Exclude Python source from Prettier

- In `.prettierignore`, add `*.py` on its own line. Do not add `uv.lock` or `*.toml` —
  research note 4 confirmed directory-glob `prettier --check .` already skips them
  without an ignore entry.

### 5. Wire lefthook for Python

- In `lefthook.yml`, under the existing `pre-commit.commands` block (which already runs
  `parallel: true`), add three new commands scoped to `*.py` so they never fire on a
  TypeScript-only commit:
  ```yaml
  format-py:
    glob: "*.py"
    run: uv run ruff format {staged_files}
    stage_fixed: true
  lint-py:
    glob: "*.py"
    run: uv run ruff check {staged_files}
  typecheck-py:
    glob: "*.py"
    run: uv run mypy {staged_files}
  ```
  Keep the existing `format`/`lint`/typecheck`/`knip`commands (their globs already
exclude`.py`) untouched.
- No command exists today to exercise these end-to-end, since no `.py` file exists in the
  repo yet — that is expected and matches "zero application code touched". Step 9's
  validation only confirms `lefthook.yml` still parses and the existing TS-scoped hooks
  are unaffected.

### 6. Document the convention

- In `AGENTS.md`, add a new section (after "## Ports", matching the existing section
  style of short behavioral rules) explaining:
  - Python apps are uv workspace members under `apps/*` (declared via a `pyproject.toml`
    in the app directory); the root `pyproject.toml` is a virtual workspace root with no
    `[project]` table of its own.
  - They are linted/typechecked with ruff/mypy, not eslint/tsc.
  - `uv` auto-registers `build`/`test`/`lint`/`check`/`format` tasks; it does **not**
    register `dev`, `start`, `typecheck`, or `format:check` — those are this repo's own
    task vocabulary. A Python app therefore keeps a thin `package.json` declaring only
    those four scripts, each shelling out to `uv run`.
  - IMPORTANT: that thin `package.json`'s `"name"` must differ from the app's own
    `[project].name` in its `pyproject.toml` — reusing the same name for both collides
    (uv/turbo will refuse to register two workspace members at the same path under one
    name). Suffixing the `package.json` name (e.g. `<app-name>-tasks`) avoids this.
  - Root `.python-version` pins the interpreter for the whole workspace; an individual
    app's own `pyproject.toml` still declares its own `requires-python`.
- In `docs/conditional-docs.md`, add an entry (under "Cross-cutting constraints", next to
  the existing `scripts/dev-webhook-gateway.ts` and `supabase/config.toml` entries)
  pointing at the new `AGENTS.md` section, conditioned on "before adding a Python app, or
  changing the root `pyproject.toml`/`turbo.json` Python wiring".

### 7. Confirm knip needs no change

- Run `yarn knip` after Steps 1-6. It should pass unchanged: `knip.json`'s
  `workspaces` map only inspects JS/TS entry points per existing app, and this chore adds
  no `package.json` anywhere (the thin-`package.json` convention from Step 6 only applies
  once a real Python app exists). Do not add a speculative `ignoreWorkspaces` entry for a
  workspace that doesn't exist yet.

### 8. Wire CI for uv

- In `.github/workflows/ci.yml`, after the existing "Install dependencies" step
  (`yarn install --immutable`) and before "Lint (ESLint)", add:
  ```yaml
  - name: Install uv
    uses: astral-sh/setup-uv@v10
    with:
      enable-cache: true

  - name: Sync Python dependencies
    run: uv sync --frozen
  ```
  Use `enable-cache: true` (not `cache:`) — confirmed against the action's current
  (v10.1.0) README. Place it before the lint/typecheck/test steps so the venv exists by
  the time `turbo run lint|typecheck|test` would try to invoke any uv-backed task (none
  exist yet, but the step must be in place before the first Python app's PR needs it).
  Since the workspace currently has zero real members, this step is fast and a pure
  no-op functionally.

### 9. classify_app.md (separate repository — not part of this PR)

- This step edits a file in `~/Dev/adw-toolkit` (`commands/classify_app.md`), a different
  git repository symlinked into `.claude/commands`. It cannot be committed as part of
  this chore's branch/PR — apply and commit it separately, in that repo, against its own
  `main` branch.
- Edit the "Instructions" section of `classify_app.md` (currently: "discover the real
  workspace list rather than assuming one. Read the root `package.json` `workspaces`
  globs...") to also say: additionally read the root `pyproject.toml`'s
  `[tool.uv.workspace] members` (minus its `exclude` entries), and for each Python
  workspace directory found this way, take its workspace name from that directory's own
  `pyproject.toml` `[project] name` field (not from a `package.json`, which a Python app
  may not have beyond the thin one from Step 6).

### 10. Validate

- Run every command in `Validation Commands` below.
- Additionally (throwaway probe, per the issue's own verification section — do not
  commit any of this):
  - Create `apps/_probe/pyproject.toml`:
    ```toml
    [project]
    name = "_probe"
    version = "0.0.0"
    requires-python = ">=3.13"
    dependencies = ["pytest"]
    ```
    and `apps/_probe/tests/test_probe.py` with a single trivial passing test.
  - Run `uv sync` (extends `uv.lock` to include the probe) then
    `yarn turbo run test --dry=json --filter=_probe` and confirm the probe's `test` task
    resolves with a `uv run ... pytest` command.
  - Delete `apps/_probe/` and run `uv sync` again to restore the original `uv.lock`
    before committing anything.
- Confirm `SENTRY_AUTH_TOKEN` still reaches the website build's tracked env after the
  turbo bump: `yarn turbo run build --filter=website --dry=json | grep -A5
'"env"'` should list `SENTRY_AUTH_TOKEN`, and the task's `outputs` should include
  `.next/**`.
- Confirm `yarn turbo run test --dry=json` still lists exactly the same four workspaces
  as before this chore (`guest-communication-agent`, `pricing`, `telegram-router`,
  `website` — confirmed via a pre-chore dry run during planning), proving the new
  `exclude` list keeps every existing workspace's behavior identical.

## Test Coverage

No test needed: this chore changes build/tooling configuration only (turbo, uv, lefthook,
CI, docs) and touches zero application code under `apps/*` or `packages/*`. There is no
new runtime behavior in any app for a `*.unit.test.ts`, `*.browser.test.tsx`, or
`apps/website/e2e/*.spec.ts` to exercise. The correctness of this chore is instead proven
by the tooling gates themselves staying green (Validation Commands below) plus the
throwaway `apps/_probe` check in Step 10, which is the closest thing to "a test that would
fail without this change" available here — before this chore, that probe's `pyproject.toml`
would be entirely invisible to `turbo run test`.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn install` - Installs turbo 2.10.13 and updates `yarn.lock`
- `uv sync` - Resolves the new root uv workspace and produces `uv.lock`
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it (confirms `*.py` ignore doesn't break anything and no `.toml`/`.lock` files trip prettier)
- `yarn turbo run lint` - Lint passes across all workspaces, unchanged from before this chore
- `yarn turbo run typecheck` - Types are sound across all workspaces, unchanged from before this chore
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test` - Unit tests pass across all workspaces, unchanged from before this chore
- `yarn turbo run build --filter=website` - Production build succeeds and still receives `SENTRY_AUTH_TOKEN` / produces `.next/**` outputs (the `0a2eaad`/`3ece833` regressions stay fixed after the turbo bump)
- `yarn turbo run test --dry=json` - Lists the same four workspaces as before this chore (`guest-communication-agent`, `pricing`, `telegram-router`, `website`), proving the uv `exclude` list didn't change any existing workspace's behavior
- `yarn lefthook run pre-commit` - Confirms `lefthook.yml` still parses and the existing hooks run cleanly with the new `*.py`-scoped commands added

## Notes

- The issue's own "Verification" list mentions "the same three workspaces"; a pre-chore
  dry run during planning showed **four** (`guest-communication-agent`, `pricing`,
  `telegram-router`, `website` — `packages/pricing` counts as a workspace with a `test`
  task too). The Validation Commands above use the confirmed number.
- `uv`'s Python-workspace support in turbo is explicitly documented upstream as
  experimental and can change behavior in a future turbo release; nothing in this chore
  depends on behavior beyond what was hands-on verified against the exact `uv 0.8.20` /
  `turbo 2.10.13` combination already available in this environment.
- The actual FastAPI port of `apps/telegram-router` (the motivating case) and deployment
  of any Python app are both out of scope, per the issue.
