# Chore: Teach the monorepo Python: turbo uv workspaces + ruff/mypy/pytest toolchain

## Metadata

issue_number: `69`
adw_id: `6f813fdf`
issue_json: `{"number":69,"title":"Teach the monorepo Python: turbo uv workspaces + ruff/mypy/pytest toolchain","body":"See full issue body in the triggering command."}`

## Chore Description

This repo is 100% Node/yarn/turbo today. Every quality gate (`turbo run lint|typecheck|test`, `knip.json`, `lefthook.yml`, `.github/workflows/ci.yml`) enumerates workspaces from the root `package.json` `workspaces` globs. A Python app has no `package.json`, so without this groundwork `turbo run test` would silently stop covering it — not an error, a silent coverage gap.

Turborepo has native uv-workspace support behind a future flag (`experimentalPythonWorkspaces`), available from turbo 2.10.13, requiring uv ≥ 0.12. This chore wires that support into the repo — root `pyproject.toml` as a virtual uv workspace root, `ruff`/`mypy` declared at the root so lefthook hooks have something to invoke, `knip` taught about the `uv` binary, lefthook given Python-scoped hooks, CI given a Python setup + format-check step, and `AGENTS.md` given the behavioral rules a future Python app must follow — **with zero application code touched**.

This is a redo: a first implementation landed, was verified empirically by building a throwaway FastAPI probe app against it, seven defects were found, and the whole thing was reverted. The findings below are reproduced errors, not predictions, and this plan is written to satisfy every one of them directly rather than rediscovering them. The probe-app verification is not optional polish — it is the only way any of these defects can be caught, since none of them manifest with zero Python workspace members present.

`apps/telegram-router`'s FastAPI port (issue #70) and `.claude/commands/classify_app.md`'s uv-discovery change (already made in a separate, private toolkit repo) are both out of scope.

## Relevant Files

Use these files to resolve the chore:

- `package.json` (root) — bump `turbo` devDependency `^2.10.5` → `^2.10.13`; this is what makes `experimentalPythonWorkspaces` available at all (2.10.5 rejects the key with `Found an unknown key`).
- `turbo.json` — add `futureFlags.experimentalPythonWorkspaces`; already contains the two previously-fixed settings (`SENTRY_AUTH_TOKEN` / `ENABLE_EXPERIMENTAL_COREPACK` in `build.env`, `.next/**` in `build.outputs`) that must survive the turbo bump unchanged — confirmed present by reading the file during planning.
- `.gitignore` — add Python-generated directories so `.venv/`, caches, and egg-info never get committed.
- `.prettierignore` — add `*.py` (a documented no-op today, since prettier has no Python parser and silently skips unknown extensions, but required by the issue for when a formatter-aware tool is added later).
- `knip.json` — add `"uv"` to the existing `ignoreBinaries` array (currently `["stripe", "pkill", "lsof", "ngrok"]`); without it, knip fails the moment any workspace has a thin `package.json` invoking the `uv` binary.
- `lefthook.yml` — currently has one `pre-commit` block with TS-scoped `format`/`lint`/`typecheck`/`knip` commands and one `pre-push` `tests` command, all in the existing repo root. Add three new `*.py`-glob-scoped `pre-commit` commands, kept separate so a TypeScript-only commit pays nothing extra.
- `.github/workflows/ci.yml` — currently: checkout, corepack enable, setup-node, `yarn install --immutable`, lint, prettier check, typecheck, knip, tests. Add a pinned `astral-sh/setup-uv@v10.1.0` step (with a pinned `version:` for uv itself), `uv sync --locked`, and a dedicated `uv run ruff format --check .` step (turbo's own `format:check` task cannot be reused here — it fails pre-existing on `guest-communication-agent` scanning its own `.next/` output).
- `AGENTS.md` — repo-wide behavioral rules file, per the four-file doc convention documented in this same file. This chore adds a new section here (not a new reference doc) since everything to say is a behavioral rule, and `AGENTS.md` is already unconditionally read (`docs/conditional-docs.md` lists it under "Always").
- `docs/conditional-docs.md` — read during planning; no new entry needed. This chore extends `AGENTS.md`, which is already indexed under "Always" with no condition to add — there is no new standalone reference document being introduced.

### New Files

- `pyproject.toml` (root) — virtual uv workspace root: no `[project]` table (a `[project]` table needs a `name`, and any name colliding with the root `package.json` name or a member's name is rejected by uv), `[tool.turbo] name` set to something that collides with neither, `[tool.uv.workspace] members = ["apps/*", "packages/*"]` plus an `exclude` list naming today's four non-Python directories (`apps/guest-communication-agent`, `apps/telegram-router`, `apps/website`, `packages/pricing`) since uv requires every glob-matched directory to contain a `pyproject.toml`, `[tool.uv] required-version = ">=0.12"`, and `[dependency-groups] dev = ["ruff>=0.16", "mypy>=2.3"]`.
- `.python-version` (root) — pins the interpreter to `3.13`. Required because there is no `[project]` table to pin it otherwise; `uv.lock` then records `requires-python` on its own.
- `uv.lock` (root, generated by `uv lock`, committed) — lockfile for the root dev dependency group (ruff, mypy). This is what makes `uv run ruff format {staged_files}` resolvable in lefthook instead of failing with `No such file or directory`.
- `apps/_probe/pyproject.toml` (temporary, deleted before this chore is done) — a real uv workspace member: `[project] name = "_probe"`, `requires-python = ">=3.13"`, a minimal `fastapi` dependency, and `[dependency-groups] dev = ["ruff>=0.16", "mypy>=2.3", "pytest>=8"]` — the dev group is the whole point of the probe, since turbo only registers `lint`/`test` tasks for a uv member when it declares the corresponding tool.
- `apps/_probe/package.json` (temporary, deleted before this chore is done) — thin package.json, `"name": "_probe-tasks"` (must differ from the pyproject.toml's `_probe`, or turbo refuses: `it already exists at ".../package.json"`), `scripts.typecheck` running `uv run mypy --explicit-package-bases .` and `scripts."format:check"` running `uv run ruff format --check .` (turbo does not synthesize either).
- `apps/_probe/main.py` (temporary) — one trivial FastAPI module, enough to exercise `ruff`/`mypy` against real code.
- `apps/_probe/tests/test_main.py` (temporary) — one passing pytest, so `turbo run test` has something real to execute and a way to prove a failing assert propagates.

## Step by Step Tasks

### 1. Bump turbo and re-verify prior fixes survive

- In root `package.json`, change `"turbo": "^2.10.5"` to `"turbo": "^2.10.13"`.
- Run `yarn install` to update `yarn.lock` and the installed binary.
- Run `yarn turbo --version` and confirm it reports `2.10.13` or newer.
- Run `yarn turbo run build --dry=json --filter=./apps/website` and confirm the `build` task's env still includes `SENTRY_AUTH_TOKEN` and `ENABLE_EXPERIMENTAL_COREPACK`, and its outputs still include `.next/**`. These were fixed in `3ece833` and `0a2eaad`; the turbo bump must not regress them.

### 2. Enable the future flag

- In `turbo.json`, add:
  ```json
  "futureFlags": { "experimentalPythonWorkspaces": true }
  ```
  at the top level (sibling of `"tasks"`).

### 3. Create the root uv workspace

- Create root `pyproject.toml` as a virtual workspace root: no `[project]` table, `[tool.turbo]` with a `name` that collides with neither the root `package.json`'s `"name"` (`issebya-homes-ai-system`) nor any current or planned member name, `[tool.uv.workspace]` with `members = ["apps/*", "packages/*"]` and `exclude` naming all four current non-Python workspace directories, `[tool.uv] required-version = ">=0.12"`, and `[dependency-groups] dev = ["ruff>=0.16", "mypy>=2.3"]`.
- Create root `.python-version` containing `3.13`.
- Run `uv lock` from the repo root and confirm it exits 0 and produces `uv.lock`. Commit the generated lockfile.
- Run `uv run ruff --version` and `uv run mypy --version` to confirm both resolve from the root dev group.

### 4. Teach the surrounding tooling about Python

- `.gitignore`: add `.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`, `*.egg-info/`.
- `.prettierignore`: add `*.py`.
- `knip.json`: add `"uv"` to `ignoreBinaries`, alongside `stripe`/`pkill`/`lsof`/`ngrok`.

### 5. Add Python-scoped lefthook hooks

- In `lefthook.yml`, add three new commands to the existing `pre-commit` block (parallel, `*.py`-glob-scoped, independent of the TS-scoped commands so a TypeScript-only commit pays nothing):
  - `py-format`: `glob: "*.py"`, `run: uv run ruff format {staged_files}`, `stage_fixed: true`.
  - `py-lint`: `glob: "*.py"`, `run: uv run ruff check {staged_files}`.
  - `py-typecheck`: `glob: "*.py"`, `run: uv run mypy --explicit-package-bases {staged_files}` — the `--explicit-package-bases` flag is required, or two staged files sharing a basename across different apps produce `Duplicate module named ...` and abort with exit 2.
- Leave `pre-push` untouched — `yarn turbo run test` already covers Python once a member declares `pytest`.

### 6. Update CI

- In `.github/workflows/ci.yml`, after the existing `Install dependencies` (`yarn install --immutable`) step, add:
  - `Set up uv` using `astral-sh/setup-uv@v10.1.0` (pin the exact tag — the floating major `@v10` does not resolve past `v7`) with a pinned `version:` matching the required minimum (e.g. `"0.12.15"`, the version verified locally) and `enable-cache: true`.
  - `Install Python dependencies`: `uv sync --locked` — not `--frozen`; `--locked` asserts the lockfile is current (mirrors `yarn install --immutable` on the Node side), `--frozen` would silently skip that check.
- Add a new step, `Format check (Ruff)`: `uv run ruff format --check .`, placed near the existing `Format check (Prettier)` step. This is deliberately a standalone step and not part of any `turbo run format:check` task.

### 7. Document the behavioral rules in AGENTS.md

- Add a new section to `AGENTS.md` (behavioral rules only, per its own stated convention — no architecture notes or env var tables) covering:
  - Python apps are uv workspace members under `apps/*` with their own `pyproject.toml`.
  - A Python member must declare `ruff`, `mypy`, and `pytest` in its dev dependency group, or turbo registers no `test` and no `lint` task for it and it silently drops out of the gates.
  - The member's thin `package.json` carries only `dev`/`start`/`typecheck`/`format:check` scripts — the two tasks turbo does not synthesize for a uv package (`lint`/`test` are synthesized when `ruff`/`pytest` are present in the dev group; `typecheck`/`format:check` are not).
  - That thin `package.json`'s `"name"` must differ from the app's `[project].name` in its `pyproject.toml` — turbo (not uv) refuses if they match. Convention: suffix with `-tasks`.
  - Consequence: two turbo packages exist at one directory once a Python app lands, and the task set divides between them. `--filter=<app-name>` resolves only the `pyproject.toml` package (`turbo run typecheck --filter=probe-svc` reports `No tasks were executed` and exits 0 even with a live type error). Filter by path instead: `--filter=./apps/<dir>`.
  - A Python app's thin `package.json` is still a yarn workspace, so it needs a `yarn.lock` entry — run `yarn install` after adding it, or every yarn command on it fails with `This package doesn't seem to be present in your lockfile`.
  - Every new **Node** app added under `apps/` or `packages/` must also be added to the root `pyproject.toml`'s `[tool.uv.workspace] exclude` list, or `uv sync` breaks (`missing a pyproject.toml`). This is a maintenance trap: it is dormant with zero Python members and springs later, on an unrelated PR.
  - A turbo warning (`Unable to resolve uv.lock; using conservative Python task hashing. failed to parse 'uv workspace metadata' output: missing field 'members'`) is expected and non-fatal until the first real Python app exists — uv omits `members` from its own workspace-metadata output when the workspace has none. It disappears once #70 lands. Its own remediation text ("run `uv lock` and commit uv.lock") is wrong in this state; the lockfile is already committed.

### 8. Probe test — prove the coverage is real

This step is temporary scaffolding, not a permanent addition. Everything created here is deleted in the last sub-step.

- Create `apps/_probe/pyproject.toml`: `[project] name = "_probe"`, `requires-python = ">=3.13"`, a `dependencies = ["fastapi"]` (or similar minimal dependency), and `[dependency-groups] dev = ["ruff>=0.16", "mypy>=2.3", "pytest>=8"]`.
- Create `apps/_probe/package.json`: `"name": "_probe-tasks"`, `"private": true`, with `scripts.typecheck = "uv run mypy --explicit-package-bases ."` and `scripts."format:check" = "uv run ruff format --check ."`.
- Create `apps/_probe/main.py`: one trivial, correctly-typed FastAPI module.
- Create `apps/_probe/tests/test_main.py`: one passing pytest.
- Run `uv sync` from the repo root and confirm it resolves the new member with no errors.
- Run `yarn install` so the new `_probe-tasks` yarn workspace gets a `yarn.lock` entry.
- Run `yarn turbo run test` and confirm it executes the real pytest. Then temporarily break the assert in `test_main.py` and confirm repo-wide `test` exits 1; restore it.
- Run `yarn turbo run lint` and confirm it executes real ruff against `_probe`. Then temporarily inject an unused import (`F401`) into `main.py` and confirm repo-wide `lint` exits 1; remove it.
- Run `yarn turbo run typecheck --filter=./apps/_probe` and confirm it executes real mypy. Then temporarily introduce a type error and confirm it exits 1; fix it.
- Run `yarn knip` and confirm it exits 0 with the probe present.
- Stage a `.py` file under `apps/_probe` and run `yarn lefthook run pre-commit`, confirming all three new Python hooks run successfully.
- Temporarily badly-format a `.py` file and run `uv run ruff format --check .` from the repo root, confirming it exits 1; then run `uv run ruff format .` to fix it and confirm a clean re-run exits 0.
- Delete `apps/_probe/` entirely (`pyproject.toml`, `package.json`, `main.py`, `tests/`).
- Run `yarn install` again (to drop the now-gone `_probe-tasks` entry) and `uv lock` (to drop `_probe` from the root lock's member resolution, if applicable), and confirm `git status` shows no trace of `apps/_probe/` and no unexpected diff to `uv.lock`/`yarn.lock` beyond removal of the probe's own entries.

### 9. Final validation

- Run every command in `Validation Commands` below and confirm all pass with the working tree containing only the intended toolchain files (root `pyproject.toml`, `.python-version`, `uv.lock`, and the config edits) — no `apps/_probe/` remnants.

## Test Coverage

No test needed: this chore is pure build-tooling and CI configuration — turbo flags, a root `pyproject.toml`, `knip`/`lefthook`/CI wiring, and an `AGENTS.md` documentation section. No application code, route, component, or user-visible behavior in `apps/website`, `apps/telegram-router`, or `apps/guest-communication-agent` changes, so none of `*.unit.test.ts`, `*.browser.test.tsx`, or `apps/website/e2e/*.spec.ts` apply. The correctness proof for this kind of change is exactly the temporary `apps/_probe` workspace in Step 8: a real uv/turbo/knip/lefthook/CI run against a real Python package, with each gate confirmed to both pass on good code and fail on injected bad code, then deleted. That is a one-time acceptance check for this PR, not a regression layer to keep — there is no Python application in the repo yet for a persisted test to protect.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions. This chore is root-level tooling, not scoped to one workspace, so most commands run repo-wide rather than with `--filter`.

- `yarn install --immutable` - Lockfile is consistent after the turbo bump and (temporarily) the probe workspace's addition/removal
- `yarn prettier --check .` - Formatting matches the repo config; `*.py` is ignored (currently a no-op, confirms it stays that way)
- `yarn turbo run lint` - Lint passes repo-wide, including on the Node workspaces, unaffected by the Python wiring
- `yarn turbo run typecheck` - Types are sound repo-wide
- `yarn knip` - No unused files, exports, dependencies, or unlisted binaries (`uv` must not be flagged)
- `yarn turbo run test` - Existing Node tests still pass repo-wide
- `yarn turbo run build --dry=json --filter=./apps/website` - Confirms `SENTRY_AUTH_TOKEN`/`ENABLE_EXPERIMENTAL_COREPACK` env and `.next/**` outputs still present on the `build` task after the turbo bump
- `uv sync --locked` - The committed `uv.lock` is current and installs cleanly with no Python workspace members present
- `uv run ruff format --check .` - Root-level ruff resolves and the repo has no badly-formatted `.py` files
- `uv run ruff check .` - Root-level ruff check resolves cleanly
- `uv run mypy --explicit-package-bases .` - Root-level mypy resolves (no Python source to check yet, but must not error on invocation)
- `yarn lefthook run pre-commit` - New Python-scoped hooks are wired correctly and don't break the existing TS-scoped ones
- `git status --short apps/_probe` - Confirms no trace of the probe workspace remains in the final diff

## Notes

- Do not attempt the `classify_app.md` change — `.claude/commands` is a symlink into a separate, private toolkit repo, already updated there. An agent editing it here writes silently into the wrong repository and leaves nothing in this repo's `git status`.
- The turbo warning about `Unable to resolve uv.lock` when running any `turbo run` command is expected with zero Python workspace members and does not indicate a defect — see the `AGENTS.md` section added in Step 7 for the exact wording and why the warning's own suggested fix is wrong in this state.
- `--filter=<workspace-path>` is not meaningful for this chore's own validation since no single app workspace is being changed; it is used only inside Step 8's probe verification, where the path form (`--filter=./apps/_probe`) is required precisely because the name form silently resolves the wrong turbo package.
- Pin the exact `astral-sh/setup-uv` tag (`v10.1.0`) and an exact `version:` for uv — both were confirmed broken/drifting in the prior attempt (floating `@v10` doesn't resolve; an unpinned uv version can silently degrade to <0.12 and disable Python task caching).
