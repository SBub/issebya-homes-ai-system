# Chore: CI weekly prune of old Vercel preview deployments

## Metadata

issue_number: `158`
adw_id: `dc773936`
issue_json: `{"number":158,"title":"CI: weekly prune of old Vercel preview deployments (Hobby plan has no retention policy control)"}`

## Chore Description

The `sbubs-projects` Vercel Hobby team is at 75% of its 10 GB Deployment Storage. Hobby's
retention policy is fixed (30 days, keep 10) and cannot be changed through the dashboard or
the API (`PATCH /v9/projects/{id}` rejects `deploymentExpiration`, `/v1/projects/{id}/retention`
is 404). #110 (`scripts/vercel-ignore.sh`) and `enableAffectedProjectsDeployments` cut how many
previews are _built_; nothing removes what the fixed policy keeps.

This chore adds a weekly GitHub Actions job that deletes preview deployments nobody can still
need, for exactly the three projects of this repo (`ihas-website`,
`ihas-guest-communication-agent`, `ihas-telegram-router`), and prints what it deleted and why.

Contracts (from the issue, not preferences):

- **Selection rule** (pure, unit-tested). A deployment is a candidate when:
  - `state === "READY"`, `target !== "production"`, `created` older than `maxAgeDays` (7), and it
    is **not** the newest READY preview of a branch that still exists on `origin`
    (`git ls-remote --heads origin`); or
  - `state` is `CANCELED` or `ERROR` and `created` is older than `failedMaxAgeDays` (1),
    regardless of branch.
  - `target === "production"` is never a candidate, whatever its age or state.
- **Fail closed**: empty `VERCEL_TOKEN` exits 1 with one clear line before any API call (workflow
  guard step shaped like `Require SUPABASE_DB_URL`, plus the same check inside the script). A
  project whose listing fails is skipped with an error line, never read as "nothing to delete".
- **Dry run by default**; deletion only with `--apply`. Schedule forces `--apply`;
  `workflow_dispatch` has a boolean `apply` input defaulting to `false`.
- **Configuration, not discovery**: `VERCEL_TEAM_ID` (`team_4M4EY8m8u4o2F7FZl5ia9Al4`) is workflow
  `env`; the three project names are a constant in the script.
- **Output**: per project `listed / candidates / deleted / failed`, and one `uid branch age_days`
  line per deletion (or per would-be deletion in dry run). A failed delete is retried once; any
  delete still failing makes the job exit 1.
- **Trigger**: `schedule: cron "17 6 * * 1"` + `workflow_dispatch`. Not push, not PR.
- Node only, global `fetch`, no new dependencies, run with `yarn tsx`.

API surface (verified by the owner): `GET /v6/deployments?teamId=&projectId=&limit=100[&until=]`
paginated via `pagination.next` (pass it back as `until`; stop when `null`), items carry `uid`,
`state`, `target` (`"production"` or absent/null), `created` (ms), `meta.githubCommitRef`.
`DELETE /v13/deployments/{uid}?teamId=`. Auth: `Authorization: Bearer $VERCEL_TOKEN`.
`projectId` accepts the project name.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md` - Root conventions; holds the Vercel notes (the `ignoreCommand` /
  `Deploy-Preview: yes` paragraph) that the new prune paragraph sits next to.
- `apps/website/AGENTS.md` - The gated Vitest `unit` project lives in this workspace and runs in
  CI and on pre-push; the new unit test goes there.
- `apps/website/vitest.config.ts` - Confirms the `unit` project includes `src/**/*.unit.test.ts`
  under the node environment. No change needed.
- `apps/website/src/lib/__tests__/vercel-ignore.unit.test.ts` - #110's precedent: a root
  `scripts/` artifact tested from the website's gated unit project via a relative path.
- `turbo.json` - `website#test` lists `$TURBO_ROOT$/scripts/vercel-ignore.sh` as an input so the
  cache invalidates when the script changes. The new `scripts/lib/vercel-prune.ts` must be added
  the same way, otherwise a change to the selection rule can hit a stale cached green test.
- `knip.json` - Root workspace has no explicit config; knip discovers root entries from
  `package.json` scripts. The new script is made an entry via a root `package.json` script (see
  tasks) so knip does not report `scripts/lib/vercel-prune.ts` or the CLI as unused.
- `package.json` (root) - `tsx` is already a root devDependency; add a `vercel:prune` script.
- `.github/workflows/eval-golden.yml` - Precedent for checkout + `corepack enable` + Node 22 with
  yarn cache + `yarn install --immutable` + `yarn tsx` with secrets in `env`.
- `.github/workflows/migrations.yml` - Precedent for the `Require SUPABASE_DB_URL` fail-closed
  guard step (`if [ -z "${X:-}" ]; then echo "::error::..."; exit 1; fi`).
- `scripts/vercel-ignore.sh` - Context: #110's build-side reduction; not modified.
- `scripts/dev-webhook-gateway.ts` - Style precedent for a root TypeScript script run with tsx
  (top-of-file doc comment explaining why the file exists).
- `docs/conditional-docs.md` - Index; the root `AGENTS.md` entry's "Covers" line gets the prune
  job added so future agents find it.

### New Files

- `scripts/lib/vercel-prune.ts` - Pure logic, no I/O: types, `selectPrunable`, `planProject`,
  `parseLsRemoteHeads`. Imported by the CLI and by the unit test.
- `scripts/vercel-prune-previews.ts` - CLI: env/arg parsing, `git ls-remote`, Vercel API calls,
  retry, output, exit code.
- `apps/website/src/lib/__tests__/vercel-prune.unit.test.ts` - Unit tests for the pure module.
- `.github/workflows/vercel-prune.yml` - Scheduled + dispatchable workflow.

**Location decision (state it in the PR):** the pure module lives in `scripts/lib/` next to its
only runtime caller, and its test lives in `apps/website/src/lib/__tests__/` following #110. The
root has no Vitest project and no `test`/`typecheck` task, so a test under `scripts/` would run
nowhere; the website's `unit` project is the one that CI and pre-push already run. Importing it
into the website test also means `website`'s `tsc --noEmit` typechecks the module (tsc follows
the relative import), which is the only typecheck the pure logic gets. The CLI file itself is not
imported by any workspace (importing it would execute `main()`), so keep all branching logic in
the pure module and the CLI thin.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create the pure module `scripts/lib/vercel-prune.ts`

- Top-of-file comment (a few lines): why this exists (Hobby retention fixed at 30 days / keep 10,
  not changeable), that it never selects production, and that it is pure so the website's gated
  unit project can test it.
- Types:
  ```ts
  export type Deployment = {
    uid: string;
    state: string; // READY | CANCELED | ERROR | BUILDING | QUEUED | ...
    target?: string | null; // "production" or absent/null for preview
    created: number; // ms since epoch
    meta?: { githubCommitRef?: string } | null;
  };
  export type Candidate = {
    uid: string;
    branch: string | null;
    ageDays: number;
    reason: "stale-preview" | "failed";
  };
  export type PruneOptions = { maxAgeDays: number; failedMaxAgeDays: number };
  export type Listing = { ok: true; deployments: Deployment[] } | { ok: false; error: string };
  export type ProjectPlan = { listed: number; candidates: Candidate[]; error?: string };
  ```
- `export function selectPrunable(deployments, liveBranches: ReadonlySet<string>, now: number, opts): Candidate[]`:
  - Skip every deployment whose `target === "production"` first, before any other check.
  - Compute `newestLive`: for each READY non-production deployment whose `meta.githubCommitRef` is
    in `liveBranches`, keep the uid with the greatest `created` per branch. This is computed over
    **all** READY previews regardless of age, so an 8-day-old preview that is still its live
    branch's newest is kept.
  - `ageDays = (now - created) / 86_400_000`.
  - READY + `ageDays > opts.maxAgeDays` + uid not in `newestLive` → `reason: "stale-preview"`.
  - (`CANCELED` | `ERROR`) + `ageDays > opts.failedMaxAgeDays` → `reason: "failed"`.
  - Everything else (other states such as BUILDING/QUEUED/INITIALIZING, young deployments) is
    never a candidate.
  - A deployment without `meta.githubCommitRef` (CLI/dashboard deploy) has `branch: null`, is never
    "newest on a live branch", and so is a candidate once older than `maxAgeDays`. Document this in
    a one-line comment.
- `export function planProject(listing: Listing, liveBranches, now, opts): ProjectPlan`:
  - `ok: false` → `{ listed: 0, candidates: [], error: listing.error }`.
  - `ok: true` → `{ listed: deployments.length, candidates: selectPrunable(...) }`.
- `export function parseLsRemoteHeads(output: string): Set<string>`: parse lines
  `<sha>\trefs/heads/<name>` into branch names (branch names can contain `/`; strip only the
  `refs/heads/` prefix; ignore blank lines).
- `export const DEFAULT_OPTIONS: PruneOptions = { maxAgeDays: 7, failedMaxAgeDays: 1 }`. Only export
  what the CLI or test imports (knip checks exports).

### 2. Create the CLI `scripts/vercel-prune-previews.ts`

- Top-of-file doc comment in the style of `scripts/dev-webhook-gateway.ts`: the problem (Hobby
  storage, fixed retention), the rule, dry-run default, never production, out-of-bounds projects.
- `const PROJECTS = ["ihas-website", "ihas-guest-communication-agent", "ihas-telegram-router"] as const;`
- `main()`:
  1. `const apply = process.argv.includes("--apply")`. Reject any other unknown arg with exit 1
     (so a typo like `--aply` fails loudly instead of silently dry-running while the operator
     believes it applied).
  2. Read `VERCEL_TOKEN` and `VERCEL_TEAM_ID` from `process.env`. If either is empty, print one line
     to stderr (e.g. `VERCEL_TOKEN is not set. Create a team-scoped token at vercel.com → Account →
Tokens and add it as repo secret VERCEL_TOKEN. Refusing to run.`) and `process.exit(1)` before
     any network call.
  3. Live branches: `execFileSync("git", ["ls-remote", "--heads", "origin"], { encoding: "utf8" })`
     → `parseLsRemoteHeads`. **Fail closed** if it throws or yields zero branches, or if neither
     `develop` nor `master` is in the set: exit 1 with one line. An empty set would make every
     branch's newest preview deletable, which is exactly what the exception exists to prevent.
  4. Print a header: mode (`DRY RUN` / `APPLY`), team id, live branch count, thresholds.
  5. For each project (sequentially):
     - `listAll(project)`: loop `GET https://api.vercel.com/v6/deployments?teamId=…&projectId=<name>&limit=100[&until=<next>]`
       with `Authorization: Bearer`, following `pagination.next` until it is `null`/absent. Any
       non-2xx or thrown fetch/JSON error returns `{ ok: false, error: "<status> <body snippet>" }`.
       Never return a partial list as `ok: true`. Also guard against a non-advancing cursor (same
       `next` twice) by returning an error.
     - `planProject(...)`. If `plan.error`, print `::error::<project>: could not list deployments
(<error>); skipped, nothing deleted` and mark the run failed.
     - Sort candidates oldest first. For each: print `  <uid> <branch ?? "-"> <ageDays.toFixed(1)>
<reason>`. In apply mode, `DELETE https://api.vercel.com/v13/deployments/<uid>?teamId=…`; on
       non-2xx or throw, wait ~2 s and retry once; still failing → count as failed and print
       `::error::<project> delete <uid> failed: <status>`. Treat 404 on delete as success (already
       gone — e.g. Vercel's own retention got there first); say so in the line.
     - Print `<project>: listed=N candidates=N deleted=N failed=N` (deleted=0 in dry run; label the
       dry-run line so it is clear nothing was deleted, e.g. `would-delete=N`).
  6. If `GITHUB_STEP_SUMMARY` is set, append the per-project count table (markdown) to it so the
     summary is visible on the run page without opening the log. Use `appendFileSync`.
  7. Exit 1 if any project failed to list or any delete failed after retry; else 0.
- Use `node:child_process`, `node:fs` and global `fetch` only; import from `./lib/vercel-prune`.
  Call `main()` at the bottom with a `.catch` that prints and exits 1.
- Never log the token.

### 3. Add the unit test `apps/website/src/lib/__tests__/vercel-prune.unit.test.ts`

- Import via relative path, matching #110:
  `import { planProject, selectPrunable, parseLsRemoteHeads, DEFAULT_OPTIONS } from "../../../../../scripts/lib/vercel-prune";`
- Fixed `NOW` constant, a `daysAgo(n)` helper and a `dep({...})` factory.
- Cases (each its own `it`):
  1. Production READY at 400 days → not selected; also production `ERROR` at 400 days → not selected.
  2. READY preview at 6 days on a deleted branch → not selected.
  3. READY preview at 8 days on a deleted branch → selected with `reason: "stale-preview"`.
  4. Newest READY preview (8 days) on a live branch, with an older (10 days) READY preview on the
     same branch → the 8-day one is **not** selected, the 10-day one is. (This is the negative-check
     test.)
  5. The newest READY preview of a branch that is no longer in `liveBranches` → selected.
  6. `CANCELED` at 2 days → selected (`reason: "failed"`), `CANCELED` at 12 hours → not; same pair
     for `ERROR`; `CANCELED` at 2 days on a live branch → still selected ("regardless of branch").
  7. A non-READY, non-failed state (e.g. `BUILDING` at 30 days) → not selected.
  8. Preview without `meta.githubCommitRef` at 8 days → selected with `branch: null`.
  9. `planProject({ ok: false, error: "500 boom" }, …)` → `{ listed: 0, candidates: [], error: "500 boom" }`.
  10. `parseLsRemoteHeads` handles `abc\trefs/heads/feat/x-adw-1\n` and trailing blank lines.
- **Negative check (do it, then revert, and record it in the PR description):** temporarily remove
  the `newestLive` exclusion in `selectPrunable`, run
  `yarn workspace website vitest run --project unit src/lib/__tests__/vercel-prune.unit.test.ts`,
  confirm test 4 fails, restore the code, confirm it passes again.

### 4. Register the new file as a turbo input and knip entry

- `turbo.json`: add `"$TURBO_ROOT$/scripts/lib/vercel-prune.ts"` to `website#test.inputs` next to
  `vercel-ignore.sh`.
- Root `package.json`: add `"vercel:prune": "tsx scripts/vercel-prune-previews.ts"` to `scripts`
  (gives knip a root entry, and gives humans `yarn vercel:prune` for a local dry run).
- Run `yarn knip`. If it still reports `scripts/lib/vercel-prune.ts` or its exports as unused (the
  website workspace's `project` glob is `src/**`, so the file belongs to the root workspace), add
  a root workspace entry to `knip.json`: `".": { "entry": ["scripts/*.ts"], "project": ["scripts/**/*.ts"] }`
  and re-run until clean. Do not use `ignoreFiles` for it.

### 5. Create `.github/workflows/vercel-prune.yml`

- Header comment: why (Hobby retention fixed, link issue #158), never touches production, only the
  three projects in the script, dry run by default, schedule applies, how to dispatch a dry run,
  that `VERCEL_TOKEN` is a team-scoped token the owner creates.
- ```yaml
  name: Vercel preview prune
  on:
    schedule:
      - cron: "17 6 * * 1" # Mondays 06:17 UTC; GitHub may start it late, acceptable here
    workflow_dispatch:
      inputs:
        apply:
          description: "Actually delete (default is a dry run)"
          type: boolean
          default: false
  permissions:
    contents: read
  concurrency:
    group: vercel-prune
    cancel-in-progress: false
  jobs:
    prune:
      runs-on: ubuntu-latest
      env:
        VERCEL_TEAM_ID: team_4M4EY8m8u4o2F7FZl5ia9Al4
      steps:
        - uses: actions/checkout@v4 # needed for `git ls-remote --heads origin`
        - name: Enable Corepack
          run: corepack enable
        - uses: actions/setup-node@v4
          with: { node-version: "22", cache: "yarn" }
        - name: Install dependencies
          run: yarn install --immutable
        - name: Require VERCEL_TOKEN
          env:
            VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          run: |
            if [ -z "${VERCEL_TOKEN:-}" ]; then
              echo "::error::VERCEL_TOKEN is not set. Create a token scoped to the sbubs-projects team (vercel.com → Account → Tokens) and add it as repo secret VERCEL_TOKEN. Refusing to call the Vercel API."
              exit 1
            fi
        - name: Prune previews
          env:
            VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          run: yarn tsx scripts/vercel-prune-previews.ts ${{ (github.event_name == 'schedule' || inputs.apply) && '--apply' || '' }}
  ```
- Put the guard **before** `yarn install` if you want the no-secret run to fail in seconds; either
  order satisfies "before any API call". Prefer guard first (cheaper, and the failing step name is
  the first thing a reader sees).
- Format with prettier (YAML is covered by `prettier --check .`).

### 6. Document it

- Root `AGENTS.md`: after the `ignoreCommand` / `Deploy-Preview` bullet in the Python/Vercel
  section, add one bullet: `.github/workflows/vercel-prune.yml` exists because Hobby's deployment
  retention is fixed (30 days, keep 10) and cannot be configured; it runs Mondays with `--apply`,
  deletes READY previews older than 7 days except the newest preview of a branch still on origin,
  and CANCELED/ERROR deployments older than 1 day, for the three projects named in
  `scripts/vercel-prune-previews.ts` only; it never touches production. Dry run: dispatch the
  workflow with `apply` unchecked, or locally `VERCEL_TOKEN=… VERCEL_TEAM_ID=… yarn vercel:prune`.
  Selection logic is in `scripts/lib/vercel-prune.ts`; change it together with its unit test.
  No em-dashes in this copy (repo owner preference); use commas/colons.
- `docs/conditional-docs.md`: extend the root `AGENTS.md` entry's "Covers" line with "the weekly
  Vercel preview prune job".

### 7. Run the Validation Commands

- Run every command below and fix anything red.

### 8. Record the guard run and the secret handoff (PR description)

- Push the branch. Attempt `gh workflow run vercel-prune.yml --ref <branch>`. The repo's default
  branch is `develop`, and GitHub only allows `workflow_dispatch` for workflows that exist on the
  default branch, so this will most likely be refused until the PR lands on `develop`. If refused,
  say so in the PR description and leave the guard-run URL as a post-merge step: after merge to
  `develop`, `gh workflow run vercel-prune.yml --ref develop` (no secret yet) must fail at
  `Require VERCEL_TOKEN` with the intended message; paste that run URL on the issue. Do not add a
  `push`/`pull_request` trigger to get around this.
- PR description must contain the owner handoff: create a Vercel token scoped to the
  `sbubs-projects` team (vercel.com → Account → Tokens), add it as repo secret `VERCEL_TOKEN`,
  then dispatch a dry run (counts, nothing deleted), then dispatch `apply=true`, and paste both
  summaries on the issue. Also state the test-location decision and the negative-check result.

## Test Coverage

- `apps/website/src/lib/__tests__/vercel-prune.unit.test.ts` (`*.unit.test.ts`, gated `unit`
  project, runs in CI and on pre-push): proves the selection rule, which is the only part that can
  delete something that should be kept. It catches production being selected at any age, previews
  being deleted before 7 days, the newest preview of a live branch being deleted (verified by the
  remove-and-revert negative check), failed deployments being kept or deleted at the wrong age, a
  failed listing being turned into "no candidates, no error", and `ls-remote` parsing dropping
  slash-containing branch names. Nothing covers any of this today; the logic is new.
- The CLI's I/O (fetch pagination, delete retry, exit codes) and the workflow YAML are not unit
  tested: they are thin wiring around the pure module and are proven by the dispatched runs in
  step 8 (guard failure, dry run, apply run), which the issue requires as its verification.
- No Playwright spec: no user-visible website flow changes.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting (TS, YAML, MD) matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace hosting the test
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound, including `scripts/lib/vercel-prune.ts` pulled in by the test import
- `yarn tsc --noEmit --module es2022 --moduleResolution bundler --target es2022 --strict --noUncheckedIndexedAccess --skipLibCheck --types node scripts/vercel-prune-previews.ts` - Typechecks the CLI itself (and the pure module it imports), which no workspace typecheck covers
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit tests (including the new selection tests) pass with zero regressions
- `VERCEL_TOKEN= VERCEL_TEAM_ID=x yarn tsx scripts/vercel-prune-previews.ts; test $? -eq 1` - Script fails closed with its one-line message before any network call when the token is empty
- `VERCEL_TOKEN=x VERCEL_TEAM_ID=x yarn tsx scripts/vercel-prune-previews.ts --aply; test $? -eq 1` - Unknown argument is rejected rather than silently running
- `yarn lint && yarn typecheck && yarn test && yarn knip` - The issue's full repo gate is green
- `yarn turbo run build --filter=./apps/website` - Production build still succeeds (no app code changed; sanity check)

## Notes

- `workflow_dispatch` needs the workflow file on the default branch (`develop`), so the
  "dispatched dry run stops at the guard" evidence can likely only be produced after merge to
  `develop`. That is a limitation of GitHub, not a reason to add other triggers.
- Scheduled workflows also only run from the default branch (`develop`), which is what we want.
- Scheduled workflows in a repo with no activity for 60 days are auto-disabled by GitHub; not a
  concern for this repo today, but it is why a silent stop would look like "no run", not a failure.
- The `until` cursor: Vercel returns `pagination.next` as a `created` timestamp; pass it verbatim.
- 404 on DELETE counts as success (already gone); any other failure is retried once after a short
  wait, then reported and fails the job.
- Never touch other projects in the team; the project list is a hardcoded constant, never
  discovered from `/v9/projects`.
- Out of scope: production deployments, what gets built (#110), Vercel Cron inside an app.
- Commits: conventional (`chore(ci): ...`), no `Co-Authored-By` trailer.
