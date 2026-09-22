# Patch: deliver the stranded migration through a real promotion, then prove the gate blocks

## Metadata

adw_id: `3874a012`
review_change_request: `Issue #3: Spec steps 6 and 8 were not executed, so neither the green path nor the failing path of the new gate has ever been observed on a runner, and the migration the whole repair exists to deliver is still stranded. gh run list --workflow=migrations.yml --branch=master --limit=5 shows the newest master run is still 34486392180 (2026-09-10, failure); no post-merge push run has applied 20260921092000_grant_anon_select_documents.sql, so prod still holds the 2026-09-21 hand-run GRANTs with no supabase_migrations.schema_migrations row. gh pr list --state open shows only #104 (this branch into develop) and #59, so no develop-to-master promotion PR exists and the spec's gh pr checks <promotion-pr-number> Validation Command cannot be evaluated. gh run view 35603199160 --json jobs confirms prod-migration-sync reports skipped on every run of this branch, correctly, since its if gates on github.base_ref == 'master', which means the job's shell has never executed. Step 8's deliberate-failure PR was not opened and no run id for it appears in the workflow header, so the file's own standard ('a gate nobody has seen fail is a gate nobody knows works') is unmet. I did replay the comparison logic verbatim against the real origin/master and HEAD trees: assertion 1 and assertion 2 both come back empty, assertion 3 correctly reports 20260921092000, and deleting 20260828120000 from the PR tree correctly trips assertion 2. So this is an unverified gate, not a known-broken one. Resolution: Blocked behind findings 2 and 1, in that order; the gate cannot report green while link fails, and it should not be required before it has. Then step 6: land this branch on develop, open the develop-to-master promotion PR, and confirm check, eval-gate, drift-check and prod-migration-sync all report on it with none of them skipped (gh pr checks <pr>). Expect assertions 1 and 2 empty and the informational summary naming 20260921092000. Merge it, watch the push run apply that migration, then dispatch job=drift-check once more and confirm no drift, that is the same thing as prod finally recording 20260921092000. Then step 8: from a throwaway branch off master, open a draft PR into master deleting supabase/migrations/20260828120000_grant_service_role_all_public.sql, confirm prod-migration-sync assertion 2 fails and the merge button is blocked, close the PR without merging, delete the branch, and record that run id in the workflow header next to assertion 2's comment. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`

**Issue:** Spec steps 6 and 8 were never executed. The gate exists as YAML whose shell has
never run on a runner, and the migration the chore exists to deliver is still stranded.
Re-verified live while writing this plan:

- `gh run list --workflow=migrations.yml --limit 12` shows no `master`-branch run at all
  since `34486392180` (2026-09-10, failure). No `push` run has applied
  `20260921092000_grant_anon_select_documents.sql`, so prod still holds the 2026-09-21
  hand-run `GRANT`s with no `supabase_migrations.schema_migrations` row.
- `gh pr list --state open` returns only #104 (this branch into `develop`) and #59. No
  `develop`-to-`master` promotion PR exists, so `gh pr checks <promotion-pr-number>` has
  nothing to evaluate.
- `prod-migration-sync` (`.github/workflows/migrations.yml:540`) gates on
  `github.base_ref == 'master'`, and every run so far has been a PR into `develop`, so it
  reports `skipped` every time and its shell has never executed.
- No deliberate-failure run id appears in the header, so the file's own standard, "a gate
  nobody has seen fail is a gate nobody knows works", is unmet.

**Solution:** Execute spec step 6 and spec step 8. Land this branch on `develop`, open the
promotion PR into `master`, confirm all four checks report with none `skipped`, merge it
and watch the `push` job finally write the `schema_migrations` row for `20260921092000`,
then open a throwaway PR into `master` that deliberately trips assertion 2, confirm the
merge button is blocked, and record both run ids in the workflow header.

**Ordering.** The review request's order is the executable one and this plan follows it,
with one seam: finding 1 (the ruleset PUT) sits _between_ the two halves of this patch,
not entirely before it. The request says as much itself, "it should not be required before
it has [reported green]". The full sequence is:

1. Finding 2, `specs/patch/patch-adw-3874a012-reveal-probe-and-link-remediation.md`: the
   prod connection works and a dispatched `job=drift-check` is green.
2. **This patch, steps 1 to 4** (spec step 6): promote, observe the green path, deliver
   `20260921092000`.
3. Finding 1, `specs/patch/patch-adw-3874a012-promote-ruleset-and-reconcile-header.md`
   (spec step 7): the ruleset PUT that makes the two contexts required.
4. **This patch, steps 5 to 7** (spec step 8): observe the failing path and the blocked
   merge button. This half genuinely needs finding 1, because "the merge button is
   blocked" is a property of the ruleset, not of the workflow.

**Blocked today, and the blocker moved since the previous round.** The `link` remediation
itself has landed: `push`, `drift-check` and `prod-migration-sync` now connect with
`--db-url "$SUPABASE_DB_URL"` and no job outside `diagnose` calls `supabase link`
(`:402`, `:497`, `:511`, `:663`; the only remaining `link` is `:868`, inside `diagnose`,
deliberately). What is missing is the secret itself: `gh secret list` returns
`BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT_ID`, `OPENROUTER_API_KEY`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and **no `SUPABASE_DB_URL`**. The
fail-closed guard added for exactly this (`:381`, `:443`, `:599`) is doing its job:
dispatched `drift-check` run `35607215583` (2026-09-21 13:41Z) failed at
`Require SUPABASE_DB_URL` before reaching the comparison. Creating that secret needs the
prod database password, which only a Supabase org owner can read, so it cannot be done
from this branch. Step 1 below is a hard precondition check with an explicit abort.

**Out of scope:** the ruleset PUT and the hedged-prose flips at `:30-31`, `:546` and
`apps/website/app_docs/database/production-migrations.md:51` (finding 1's patch owns all
three, do not duplicate them here), the `SUPABASE_DB_URL` secret creation (finding 2's
patch owns the operator handoff), and the pre-existing `eval-gate`-behind-a-`paths:`-filter
hazard the spec's Notes flag.

## Files to Modify

Use these files to implement the patch:

- `.github/workflows/migrations.yml` - the only repository file this patch edits, and only
  its comment prose. Two additions: a header paragraph recording the two proof runs, and a
  pointer line on the assertion 2 comment at `:705-712` naming the deliberate-failure run
  id.

Everything else this patch produces lives outside the repo: a merge of PR #104 into
`develop`, a `develop`-to-`master` promotion PR, a post-merge `push` run, a dispatched
`drift-check` run, and a throwaway PR into `master` opened and closed without merging.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify the precondition, and stop if it is not met

Do not proceed on assumption. Both conditions, in this order:

1. The `SUPABASE_DB_URL` repo secret exists: `gh secret list` must list it. Currently
   false.
2. A dispatched `drift-check` run exists and is green against current `master`:
   `gh run list --workflow=migrations.yml --event=workflow_dispatch --limit 10` must show
   a `job=drift-check` row with conclusion `success`, and
   `gh run view <id> --json jobs --jq '.jobs[] | {name, conclusion}'` must show
   `drift-check` as `success` rather than skipped. Currently false: the newest such run,
   `35607215583`, is a `failure` at the `Require SUPABASE_DB_URL` step.

**If either fails, abort this patch and report the blocker rather than proceeding.**
Opening the promotion PR while the connection is unusable means `drift-check` and
`prod-migration-sync` both go red for a credentials reason on the one PR that is supposed
to demonstrate the green path, which is worse than not opening it: it puts a red promotion
PR in front of the next person with no way to tell a real drift signal from a missing
secret. Report which condition is unmet and the run id that demonstrates it.

### Step 2: Land this branch on `develop`

- Commit the untracked patch plans under `specs/patch/` together with any workflow prose
  finding 2 produced, conventional-commit style, no `Co-Authored-By` trailer
  (`ci(migrations): ...`, matching this file's commit history).
- Merge PR #104 (`chore/issue-89-adw-3874a012-require-prod-migration-sync` into
  `develop`). `develop` is not covered by the `protect-master` ruleset, so this merge is
  gated only by the ordinary `check` job.
- Confirm `origin/develop` now carries the job:
  `git show origin/develop:.github/workflows/migrations.yml | grep -n "prod-migration-sync:"`.
  This matters beyond tidiness: GitHub registers `workflow_dispatch` inputs from the
  default branch, which is `develop` here, so the dispatch arms are only addressable by
  name once they are on `develop`.

### Step 3: Open the promotion PR and confirm all four checks report

- `gh pr create --base master --head develop --title "ci: promote develop to master"` with
  a body naming `20260921092000_grant_anon_select_documents.sql` as what the merge
  delivers to prod, ending with the repo's PR attribution line.
- `gh pr checks <promotion-pr-number>` must list all four contexts, **none of them
  `skipped`**: `check`, `eval-gate`, `drift-check`, `prod-migration-sync`. Cross-check per
  job with `gh run view <run-id> --json jobs --jq '.jobs[] | {name, conclusion}'`, because
  `gh pr checks` alone does not distinguish a job that ran and passed from one that was
  skipped into a pass. That distinction is the entire finding being closed here.
- Expected results, and what each proves:
  - `drift-check` green. It pins `ref: master`, and `master` stops at `20260828120000`
    which prod holds, so the two sides agree. It deliberately does not see this PR's
    migration.
  - `prod-migration-sync` green, and this is the first time its shell has ever run.
    Assertion 1 (`master_local - remote`) empty, assertion 2 (`remote - pr_local`) empty
    (prod's history stops at `20260828120000`, because the 2026-09-21 grants were hand-run
    without a `schema_migrations` row), and assertion 3 plus the step summary naming
    exactly `20260921092000` as what the merge will apply.
  - Read the `::group::supabase migration list --db-url` output in the log rather than
    trusting the green tick. The parse guard turns a changed JSON shape into an explicit
    error, but this is the first observation of that shape against real prod over
    `--db-url` rather than `--linked`, and it is worth looking at once.
- GOTCHA, the thing most likely to stall this step: `eval-gate` sits behind a `paths:`
  filter on `apps/guest-communication-agent/**`. If this promotion carries no GCA change,
  `eval-golden.yml` never runs, the `eval-gate` context never reports, and the merge is
  blocked on a permanently pending required check. That is a pre-existing defect, out of
  scope here, and must **not** be worked around by editing `eval-golden.yml` or by removing
  the context from the ruleset. If it bites, record it, raise it as its own issue, and
  treat this patch as blocked on it.

### Step 4: Merge, watch the push, and confirm prod is finally in sync

- Merge the promotion PR.
- The `push` job fires, because the merge touches `supabase/migrations/**`. Watch it:
  `gh run list --workflow=migrations.yml --branch=master --limit=5` then
  `gh run watch <run-id>`.
- It must apply `20260921092000`. The three `grant` statements re-run harmlessly over the
  hand-applied state and the `schema_migrations` row is finally written. That row is the
  entire point of the chore.
- Dispatch one more `gh workflow run migrations.yml --ref develop -f job=drift-check`,
  `gh run watch` it, and confirm no drift. This is the independent confirmation that prod
  now records `20260921092000`, read back through a different job than the one that wrote
  it.
- If the `push` run fails, stop. Do not continue to step 5 and do not let finding 1's
  ruleset PUT proceed: a failed push means the promotion merged on top of a still-broken
  delivery pipeline, which is exactly the condition assertion 1 exists to catch, and the
  next promotion PR will then go red on it legitimately.

### Step 5: Hand off to finding 1, then return

Spec step 7 runs here, not before and not after. Execute
`specs/patch/patch-adw-3874a012-promote-ruleset-and-reconcile-header.md` in full: its
precondition is now satisfied (a green `prod-migration-sync` on a real PR into `master`,
from step 3), and its PUT is what makes `drift-check` and `prod-migration-sync` required
contexts on `protect-master`.

Do not start step 6 until
`gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`
returns all four contexts. Without that, the deliberate-failure PR below can show a red
check but cannot show a blocked merge button, and the blocked button is the half of the
acceptance criterion that is actually behavioural.

### Step 6: Prove the gate blocks

- From current `master`, create a throwaway branch that deletes a migration prod holds:
  ```
  git fetch origin master
  git switch -c chore/prove-prod-migration-sync-blocks origin/master
  git rm supabase/migrations/20260828120000_grant_service_role_all_public.sql
  git commit -m "ci(migrations): deliberately delete an applied migration to prove the gate blocks"
  git push -u origin chore/prove-prod-migration-sync-blocks
  gh pr create --draft --base master --head chore/prove-prod-migration-sync-blocks \
    --title "DO NOT MERGE: prove prod-migration-sync assertion 2 blocks"
  ```
  Say in the first line of the PR body that it exists to be closed.
- Expected: `prod-migration-sync` fails on assertion 2 with "Prod holds migration versions
  with no file in this PR's tree", listing `20260828120000`. `drift-check` on the same PR
  stays **green**, because it pins `ref: master` and compares prod against `master`'s tree
  rather than the PR's. That contrast is the whole argument for keeping both jobs (spec
  Notes) and is worth capturing in the record.
- GOTCHA on observing the blocked merge button: `gh pr view <n> --json mergeStateStatus`
  returns `DRAFT` for a draft PR, which masks `BLOCKED` and proves nothing about the
  ruleset. Once the check has already gone red, mark it ready (`gh pr ready <n>`), read
  `mergeStateStatus` again (expected `BLOCKED`), then close it. Doing it in that order is
  safe precisely because the required check is red: there is no state in which this PR is
  mergeable.
- Close without merging and delete the branch:
  ```
  gh pr close <n>
  git push origin --delete chore/prove-prod-migration-sync-blocks
  git switch develop
  ```
  Then confirm the proof left no residue:
  `git ls-tree --name-only origin/master supabase/migrations/ | grep 20260828120000`.

### Step 7: Record both proofs in the workflow header

The file is this incident's record. Two run ids belong in it, in the header's reasoned
prose style rather than as a bullet list.

- Add a short header paragraph stating that the gate has now been observed on both paths:
  the promotion PR run id from step 3, where all three assertions behaved as specified and
  the merge applied `20260921092000`, and the deliberate-failure run id from step 6, where
  assertion 2 failed on a deleted `20260828120000` and the merge button read `BLOCKED`.
  Name the date of each. Replace the "Outstanding, and it needs a human" paragraph's
  closing ordering sentence (`:191-205`) only insofar as it is now history rather than a
  pending instruction; leave the fail-closed guard's rationale intact.
- Add a one-line pointer on the assertion 2 comment at `:705-712` naming the
  deliberate-failure run id, so the next reader of that `if` block sees the evidence
  without searching the header. This is the "next to assertion 2's comment" the review
  request asks for.
- Do **not** edit `:30-31` or `:546` here. Finding 1's patch owns both hedged passages and
  will have flipped them in step 5; touching them again would conflict.
- Commit on a branch off `develop`, conventional-commit style, no `Co-Authored-By` trailer.

## Validation

Execute every command to validate the patch is complete with zero regressions.

1. `gh run list --workflow=migrations.yml --branch=master --limit=5` - The post-merge
   `push` run is present and green, replacing `34486392180` as the newest `master` run.
   This is the spec's own Validation Command and the chore's headline deliverable.
2. `gh pr checks <promotion-pr-number>` plus
   `gh run view <run-id> --json jobs --jq '.jobs[] | {name, conclusion}'` - All four
   contexts reported on a real PR into `master`, none of them `skipped`.
3. `gh workflow run migrations.yml --ref develop -f job=drift-check` then
   `gh run watch <run-id>` - Green, no drift, which is the same statement as prod now
   recording `20260921092000`.
4. `gh run view <deliberate-failure-run-id> --json jobs --jq '.jobs[] | {name, conclusion}'`
   - `prod-migration-sync` is `failure` and `drift-check` is `success` on the same run.
5. `gh pr list --state open --base master` and
   `git ls-tree --name-only origin/master supabase/migrations/ | grep 20260828120000` -
   The throwaway PR is closed, its branch is gone, and the deleted migration is still on
   `master`.
6. `grep -n "<promotion-run-id>\|<failure-run-id>" .github/workflows/migrations.yml` -
   Both run ids are recorded in the file alongside the existing diagnose verdicts.
7. `yarn prettier --check .` - Formatting matches the repo config so the lefthook commit
   hook will not reject it. This also parses `.github/workflows/migrations.yml`, so a
   malformed workflow fails here rather than on a runner.
8. `yarn knip` - No unused files, exports or dependencies introduced.
9. `yarn turbo run lint --filter=./apps/website`,
   `yarn turbo run typecheck --filter=./apps/website`,
   `yarn turbo run test --filter=./apps/website` - Lint, types and unit tests pass, proving
   the comment-only YAML edits caused no regression in the one workspace with tests.

## Patch Scope

**Lines of code to change:** roughly 10 to 15 lines, all comment prose in
`.github/workflows/migrations.yml`: one header paragraph recording the two proof runs and
one pointer line on the assertion 2 comment. Everything else this patch delivers is merges,
runs and a closed PR, not a diff.

**Risk level:** high, and the risk is in the sequencing rather than the edit. Step 3 opens
the first ever PR into `master` carrying these jobs and step 4 merges it, which fires the
`push` job that writes to the real hosted prod project. The migration being applied is
three idempotent `grant` statements over state that already exists, so the write itself is
about as safe as a prod write gets, but the merge is not reversible through the merge
button: `protect-master` carries `deletion` and `non_fast_forward` rules. Step 1's
precondition gate exists so this is never attempted while the prod connection is unusable,
and step 5 keeps the irreversible ruleset PUT behind the green observation that justifies
it.

**Testing required:** No automated test, for the reason the spec's Test Coverage section
argues: this is workflow YAML plus a repository ruleset, and all three of this repo's test
layers live inside `apps/website` and exercise application code. The real test is the runs
themselves, and this patch is the half of the chore that produces them: the green promotion
run is the green-path test and the deliberate-failure run is the failing-path test.
Validation commands 7 to 9 prove no regression elsewhere. Do not run `supabase start`,
`supabase db reset`, or any local database reset: the repository runs a single shared local
instance.
