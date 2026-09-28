# Chore: Vercel: build ADW previews only for the run's final (document-phase) commit

## Metadata

issue_number: `110`
adw_id: `b82db496`
issue_json: `{"number":110,"title":"Vercel: build ADW previews only for the run's final (document-phase) commit","body":"(see GitHub issue #110; summarised below)"}`

## Chore Description

Every ADW phase commits and pushes, so one run pushes about five commits, and each of the three
Vercel projects connected to this repo (`ihas-website`, `ihas-guest-communication-agent`,
`ihas-telegram-router`) builds a preview for every one of them: about 15 deployments per issue.
The Hobby plan caps deployments at 100/day, and on 2026-09-21 that cap was hit (PR #105's
Vercel checks: "Deployment rate limited — retry in 24 hours.").

The toolkit half is already done (adw-toolkit `e77d8b9`): the document phase ends every completed
run on exactly one commit whose message carries the git trailer line `Deploy-Preview: yes`
(`git_ops.PREVIEW_TRAILER`). ADW branches are always named `<type>/issue-<n>-adw-<id>-<slug>`.

This chore is the project half: a Vercel Ignored Build Step (`ignoreCommand` in each app's
`vercel.json`) backed by one shared script, `scripts/vercel-ignore.sh`, that:

1. exits 1 (build) whenever `VERCEL_ENV=production`, before anything else;
2. exits 1 (build) for any `VERCEL_GIT_COMMIT_REF` that does not contain `-adw-`, including an
   empty ref (dashboard Redeploy / CLI deploy);
3. on an `-adw-` branch, reads the full commit message from `git log -1 --format=%B` (falling back
   to `VERCEL_GIT_COMMIT_MESSAGE` only if git gives nothing) and exits 1 (build) if a line starts
   with `Deploy-Preview: yes`, otherwise exits 0 (skip, deployment state `CANCELED`).

Contracts from the issue that the implementation must honour exactly:

- The trailer match is `grep -q '^Deploy-Preview: yes'`. Do not loosen or respell it.
- Only tools in Vercel's build image: `bash`/`sh`, `grep`, `git`, `case`. No node, turbo-ignore, npx.
- The script is POSIX-`sh` compatible, executable, and lives once at the repo root. Each app's
  Root Directory is `apps/<app>`, so `ignoreCommand` is `bash ../../scripts/vercel-ignore.sh`.
- The dashboard Ignored Build Step stays on "Automatic" in all three projects (checked by the
  human during verification; stated in the PR).
- Root `AGENTS.md` gets a short paragraph next to the existing Vercel/uv notes.

**Deviation from the issue, found during research (must not be missed):** the issue says
`ls apps/*/vercel.json` returns nothing and that each file must contain _only_ `$schema` and
`ignoreCommand`. That is no longer true: `apps/telegram-router/vercel.json` already exists (commit
`6ff8dcd`) with `installCommand` (`uv sync --frozen --no-dev --no-editable --package
telegram-router`) and `buildCommand` (`python -c 'import app.main'`). Root `AGENTS.md` documents
these as mandatory: removing them ships a function with no packages (`ModuleNotFoundError` on every
request). So for telegram-router, **add** `ignoreCommand` to the existing file and keep both
existing keys unchanged. `apps/website/vercel.json` and `apps/guest-communication-agent/vercel.json`
are new and contain only `$schema` and `ignoreCommand`. Call this out in the PR description.

Also confirmed from the repo: `apps/telegram-router/README.md` (Deployment section) states the
`ihas-telegram-router` Root Directory is `apps/telegram-router`, and GCA's `.vercel/project.json`
names `ihas-guest-communication-agent`. `ihas-website` → `apps/website` is still inferred and must be
confirmed in the dashboard. Telegram-router already resolves the repo-root `uv.lock`, which shows
"Include files outside the Root Directory" is on for at least that project; the same setting must be
on for the other two or `../../scripts/vercel-ignore.sh` is missing. If it is missing, `bash` exits
127, which is non-zero, so Vercel **builds** (fails open, same behaviour as today). Note this in the PR.

The Vercel-side verification steps (1-7 of the issue) are manual, human-run against the real Vercel
account, and step 1 can void the approach (canceled builds may still count toward the 100/day cap).
They are listed below as a PR checklist, not as automated validation.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md` - Root agent rules. The Python-workspaces section already holds the Vercel build-image
  notes (the `vercel.json` `installCommand` bullet and the uv `required-version` bullet, ~lines 82-100).
  The new ADW-preview paragraph goes right after them.
- `apps/telegram-router/vercel.json` - Already exists with `installCommand` and `buildCommand`; gets
  `ignoreCommand` added, nothing removed.
- `apps/telegram-router/README.md` - Its Deployment section documents what `vercel.json` does; add
  one sentence noting the `ignoreCommand` and pointing at the root `AGENTS.md` paragraph.
- `apps/website/vitest.config.ts` - The `unit` project includes `src/**/*.unit.test.ts` in the node
  environment; the new script test lands there with no config change.
- `apps/website/src/lib/__tests__/` - Existing home of `*.unit.test.ts` files; the new test follows
  their layout (vitest `describe`/`it`/`expect`).
- `turbo.json` - The `test` task has no `inputs`, so turbo hashes only the workspace's own files. A
  change to root `scripts/vercel-ignore.sh` would hit a cached website test run and never re-test.
  Needs a `website#test` entry whose inputs include the script.
- `knip.json` - `apps/website` entry already lists `src/**/*.unit.test.ts`; confirm the new test
  needs no change. Root `scripts/*.sh` is not a JS file so knip ignores it.
- `.prettierignore` - Prettier runs over `.json`/`.md`; the new `vercel.json` files and the spec
  must be prettier-clean. `.sh` is not formatted by prettier.
- `docs/conditional-docs.md` - Index of docs; update the root `AGENTS.md` entry's "Covers" line so
  a future Vercel/deploy task finds the new paragraph.
- `apps/website/AGENTS.md` - Read for the website test-layer rules (unit tests gate on push and CI).
- `.github/workflows/ci.yml` - Runs `yarn turbo run test`; the new unit test is gated there with no
  workflow change.

### New Files

- `scripts/vercel-ignore.sh` - The shared Ignored Build Step script (executable, `chmod +x`).
- `apps/website/vercel.json` - `$schema` + `ignoreCommand` only.
- `apps/guest-communication-agent/vercel.json` - `$schema` + `ignoreCommand` only.
- `apps/website/src/lib/__tests__/vercel-ignore.unit.test.ts` - Unit test that spawns the script
  against a throwaway git repo and asserts its exit codes.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create `scripts/vercel-ignore.sh`

- Content, exactly as the issue's suggestion (comment lines may be tightened but the logic and the
  grep pattern must not change):
  ```bash
  #!/usr/bin/env bash
  # Vercel Ignored Build Step. exit 0 = skip the build, exit 1 = build.
  # ADW branches (…-adw-…) build only the commit the toolkit marked with
  # the `Deploy-Preview: yes` trailer; everything else builds as usual.
  [ "$VERCEL_ENV" = "production" ] && exit 1
  case "$VERCEL_GIT_COMMIT_REF" in
    *-adw-*) ;;
    *) exit 1 ;;
  esac
  msg="$(git log -1 --format=%B 2>/dev/null)"
  [ -n "$msg" ] || msg="$VERCEL_GIT_COMMIT_MESSAGE"
  printf '%s\n' "$msg" | grep -q '^Deploy-Preview: yes' && exit 1
  exit 0
  ```
- Do not add `set -e`: the `[ ... ] && exit 1` lines return non-zero when the test is false and
  would abort the script.
- Use a plain ASCII `...` instead of the `…` in the comment, to keep the file pure ASCII.
- `chmod +x scripts/vercel-ignore.sh` and make sure git records mode `100755`
  (`git ls-files -s scripts/vercel-ignore.sh`).
- Sanity-check by hand from the repo root:
  - `VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=develop bash scripts/vercel-ignore.sh; echo $?` → `1`
  - `VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feat/issue-1-adw-abc12345-x bash scripts/vercel-ignore.sh; echo $?`
    → `0` if HEAD is a plain commit.
  - `sh scripts/vercel-ignore.sh` with the same env gives the same results (POSIX-compat check).

### 2. Add `ignoreCommand` to each app's `vercel.json`

- Create `apps/website/vercel.json`:
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "ignoreCommand": "bash ../../scripts/vercel-ignore.sh"
  }
  ```
- Create `apps/guest-communication-agent/vercel.json` with identical content.
- Edit the existing `apps/telegram-router/vercel.json`: add
  `"ignoreCommand": "bash ../../scripts/vercel-ignore.sh"` and keep `$schema`, `installCommand`
  and `buildCommand` exactly as they are.
- Nothing else goes into any of the three files.

### 3. Add the unit test `apps/website/src/lib/__tests__/vercel-ignore.unit.test.ts`

- Node environment (the `unit` vitest project). Use `node:child_process` `spawnSync`,
  `node:fs` `mkdtempSync`/`rmSync`, `node:os` `tmpdir`, `node:path`, `node:url` `fileURLToPath`
  (the package is `"type": "module"`, so derive the directory from `import.meta.url`, not `__dirname`).
- Resolve the script as `path.resolve(<this dir>, "../../../../../scripts/vercel-ignore.sh")`
  (from `apps/website/src/lib/__tests__/` up to the repo root). Assert it exists in a first test so
  a moved script fails loudly instead of every case failing on exit 127.
- `beforeEach`: create a temp dir, `git init -q`, and commit with an inline identity
  (`git -c user.name=test -c user.email=test@example.com commit --allow-empty -q -m ...`) so it
  does not depend on the machine's git config. `afterEach`: `rmSync(dir, { recursive: true, force: true })`.
- A helper `run(env)` that calls `spawnSync("bash", [script], { cwd: dir, env: { PATH: process.env.PATH, ...env } })`
  and returns `status`. Build `env` from scratch (only `PATH` plus the case's vars) so a
  `VERCEL_*` variable in the developer's shell cannot leak in.
- Cases (each asserts the exit code):
  1. ADW branch, plain commit (`-m "feat: x"`) → `0` (skip).
  2. ADW branch, marked commit (`-m "docs: x" -m "Deploy-Preview: yes"`) → `1` (build).
  3. Non-ADW branch (`develop`), plain commit → `1`.
  4. Empty `VERCEL_GIT_COMMIT_REF`, plain commit → `1`.
  5. `VERCEL_ENV=production` on an ADW branch, plain commit → `1` (production wins).
  6. ADW branch, trailer not at line start (`-m "docs: mention Deploy-Preview: yes in text"`) → `0`
     (guards the `^` anchor, i.e. the shared contract).
  7. ADW branch, cwd is a temp dir that is **not** a git repo, `VERCEL_GIT_COMMIT_MESSAGE` set to a
     message with the trailer line → `1`; same with a message without it → `0` (fallback path).
- Use `feat/issue-1-adw-abc12345-x` as the ADW branch name and `VERCEL_ENV=preview` except in case 5.
- Keep it one `describe("scripts/vercel-ignore.sh", ...)` block, matching the style of the sibling
  `*.unit.test.ts` files.

### 4. Make turbo re-run the test when the script changes

- In root `turbo.json`, add a package-specific task:
  ```json
  "website#test": {
    "outputs": [],
    "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/scripts/vercel-ignore.sh"]
  }
  ```
- Verify: `yarn turbo run test --filter=./apps/website --dry=json` shows the script among the
  task's hashed inputs (or: run the test, touch/edit the script, re-run, and see a cache miss).
  If turbo in this repo rejects `$TURBO_ROOT$`, fall back to an `apps/website/turbo.json` with
  `{"extends": ["//"], "tasks": {"test": {"inputs": ["$TURBO_DEFAULT$", "../../scripts/vercel-ignore.sh"]}}}`.

### 5. Document it

- Root `AGENTS.md`: directly after the uv `required-version` bullet in the Python-workspaces
  section (the last Vercel build-image note), add a short paragraph/bullet. No em-dashes. It says:
  - Every Vercel project's `vercel.json` sets `ignoreCommand` to `bash ../../scripts/vercel-ignore.sh`.
  - On branches whose name contains `-adw-`, only commits whose message has a line starting with
    `Deploy-Preview: yes` build a preview; every other commit on such a branch is skipped
    (Canceled). Production, `develop`, `master` and hand-made branches build as before.
  - The ADW toolkit's document phase adds the trailer to the run's final commit. The string is a
    shared contract with the toolkit's `git_ops.PREVIEW_TRAILER`; don't change it on one side.
  - To force a preview by hand: `git commit --allow-empty -m "chore: preview" -m "Deploy-Preview: yes"`.
  - Keep the dashboard's Ignored Build Step on "Automatic"; a dashboard script would be overridden
    by `vercel.json` anyway, and a new app's `vercel.json` must carry the same `ignoreCommand`.
- `apps/telegram-router/README.md` Deployment section: one sentence that `vercel.json` also sets
  `ignoreCommand` (ADW preview gating), with a pointer to the root `AGENTS.md`.
- `docs/conditional-docs.md`: extend the root `AGENTS.md` entry's "Covers" line with
  "Vercel build-image notes, ADW preview gating (`Deploy-Preview: yes`)".

### 6. Prepare the manual Vercel verification checklist for the PR

These are run by a human against the real Vercel account, not by the pipeline. Put them in the PR
body as a checklist with space for the recorded results:

1. Deployment count before/after pushing a throwaway branch `test-adw-ignore` with one plain
   commit. If it rises by 3, the ignore step does not relieve the 100/day cap: stop, do not merge,
   open the `git.deploymentEnabled` follow-up.
2. Second commit with the trailer on `test-adw-ignore`: first commit's deployments Canceled with the
   Ignored Build Step message, second commit's deployments built in all three projects.
3. GitHub status of the skipped commit via `gh api repos/SBub/issebya-homes-ai-system/commits/<sha>/status`
   and `gh pr checks`, verbatim (decides whether `ADW_CI_INFRA_PATTERN` needs a value).
4. Which message source matched: a temporary `echo` of the ref and
   `printf '%s' "$VERCEL_GIT_COMMIT_MESSAGE" | wc -l` on the throwaway branch only; never merged.
5. A non-ADW branch still builds a preview.
6. After merge, the `develop` → `master` promotion builds production in all three projects.
7. Delete `test-adw-ignore` locally and remotely; close its PR.
8. Confirm and state in the PR: each project's Root Directory, Production Branch, Ignored Build Step
   = Automatic, and "Include files outside the Root Directory" = enabled.

- Also state the telegram-router deviation (existing keys kept) from the Chore Description.

### 7. Run the Validation Commands

- Run every command below; all must pass.

## Test Coverage

- `apps/website/src/lib/__tests__/vercel-ignore.unit.test.ts` (`*.unit.test.ts`, node pool): spawns
  `scripts/vercel-ignore.sh` in a throwaway git repo and asserts the exit code for ADW-plain (skip),
  ADW-marked (build), non-ADW and empty ref (build), production (build), unanchored trailer (skip)
  and the `VERCEL_GIT_COMMIT_MESSAGE` fallback. Nothing tests this today; it would catch a script
  that inverts the 0/1 semantics (silently skipping every build, including hand-made branches) or a
  loosened/respelled trailer match that breaks the toolkit contract. It lives in the website
  workspace because that is the repo's existing node-pool unit layer that already gates on push and
  in CI; the `website#test` turbo inputs entry makes it re-run when the root script changes.
- The `vercel.json` files and doc edits need no test of their own: they are static config and prose,
  and their real behaviour can only be observed on Vercel, which is the manual checklist in task 6.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config (new `vercel.json` files, `turbo.json`, docs, spec)
- `bash -n scripts/vercel-ignore.sh && sh -n scripts/vercel-ignore.sh` - Script parses under both bash and POSIX sh
- `test -x scripts/vercel-ignore.sh && git ls-files -s scripts/vercel-ignore.sh` - Script is executable and tracked as `100755`
- `VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=develop bash scripts/vercel-ignore.sh; test $? -eq 1` - Non-ADW branch builds
- `VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=feat/issue-1-adw-abc12345-x bash scripts/vercel-ignore.sh; test $? -eq 1` - Production always builds
- `for f in apps/website/vercel.json apps/guest-communication-agent/vercel.json apps/telegram-router/vercel.json; do node -e "const j=require('./'+process.argv[1]); if(j.ignoreCommand!=='bash ../../scripts/vercel-ignore.sh') process.exit(1)" "$f" || echo "BAD $f"; done` - All three files parse and carry the exact `ignoreCommand` (no output = pass)
- `node -e "const j=require('./apps/telegram-router/vercel.json'); if(!j.installCommand||!j.buildCommand) process.exit(1)"` - telegram-router kept its install/build commands
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the website (new test file)
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the website
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit (including the new script test) and browser tests pass
- `yarn turbo run test --filter=./apps/guest-communication-agent --filter=./apps/telegram-router` - Other apps' tests unaffected
- `yarn turbo run build --filter=./apps/website --filter=./apps/guest-communication-agent` - Builds unaffected by the new `vercel.json` files

## Notes

- The script fails open: any error (missing file, missing git) produces a non-zero exit, which Vercel
  treats as "build". The worst failure mode is today's behaviour, never a skipped production build.
- Vercel clones shallow, but `git log -1` only needs HEAD, so depth does not matter.
- `grep '^Deploy-Preview: yes'` also matches a line like `Deploy-Preview: yesterday`. That is the
  agreed contract with the toolkit; do not tighten or loosen it here.
- This branch (`chore/issue-110-adw-b82db496-...`) itself contains `-adw-`, so once the three
  `vercel.json` files are on it, only its marked final commit builds a preview. That is the feature
  working, not a regression; the issue's step 8 assumption that "this branch is not an ADW branch"
  does not hold for an ADW-run PR, so expect Canceled Vercel statuses on intermediate commits and a
  built one on the document-phase head.
- Out of scope: `turbo-ignore` / per-app build pruning, `ci_ops` changes, the `git.deploymentEnabled`
  fallback, and the uncommitted deployment SOP docs.
- No Playwright spec or e2e journey: nothing user-visible on `apps/website` changes.
- Do not start dev servers for telegram-router or GCA and do not touch the shared Supabase instance;
  nothing in this chore needs either.
