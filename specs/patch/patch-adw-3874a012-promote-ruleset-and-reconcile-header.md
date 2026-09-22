# Patch: require `drift-check` and `prod-migration-sync` on `protect-master`, then reconcile the hedged prose

## Metadata

adw_id: `3874a012`
review_change_request: `Issue #1: Spec step 7 was not executed, so the chore's headline deliverable is absent. The issue title is literally 'make prod migration sync a required check for merges to master', and the spec's own Validation Command `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`returns`[{"context":"check"},{"context":"eval-gate"}]`-`drift-check`and`prod-migration-sync`are both missing. The job therefore gates nothing, and the issue's behavioural acceptance criterion ('a PR into master with an unapplied local migration or a failing link cannot merge') is false. The implementer was right not to pull this forward: the ruleset has`bypass_actors: []`and`current_user_can_bypass: "never"`, so requiring a check that can never go green would lock `master`for everyone, exactly as the spec's Notes warn, and the workflow header and the doc are both honestly hedged to match. The consequence stands regardless: merging this branch ships an inert gate. Resolution: This cannot be resolved on this branch alone while finding 2 is open - requiring a check that fails at`supabase link`would lock`master`with no admin override, which is the one outcome the spec forbids. Fix finding 2 first and get a dispatched`job=drift-check`green against current`master`. Then execute spec step 7: `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056`to fetch the body, edit only the`required_status_checks`array with`jq`to add`{"context":"drift-check"}`and`{"context":"prod-migration-sync"}`alongside the existing two, and PUT the whole body back so the`deletion`, `non_fast_forward`and`pull_request`rules,`strict_required_status_checks_policy: false`and`do_not_enforce_on_create: false`survive verbatim. The contexts must match the job ids character-for-character, since neither job sets a`name:`. Re-read the ruleset and confirm all four contexts. Then flip `apps/website/app_docs/database/production-migrations.md` from 'are intended to be required status checks' to plain present tense, and reconcile the workflow header (see finding 4). Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`

**Issue:** Spec step 7 was never executed. Re-verified live against the repo at the time of
writing this plan:

```
$ gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
    --jq '.rules[] | select(.type=="required_status_checks") | .parameters'
{"do_not_enforce_on_create":false,"required_status_checks":[{"context":"check"},{"context":"eval-gate"}],"strict_required_status_checks_policy":false}

$ gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
    --jq '{bypass_actors,current_user_can_bypass,rule_types:[.rules[].type]}'
{"bypass_actors":[],"current_user_can_bypass":"never","rule_types":["deletion","non_fast_forward","pull_request","required_status_checks"]}
```

So the `prod-migration-sync` job this chore adds gates nothing, and the issue's
behavioural acceptance criterion ("a PR into master with an unapplied local migration or
a failing link cannot merge") is false.

The prose is currently hedged three ways, and inconsistently, which is the finding 4 half
of this request:

- `.github/workflows/migrations.yml:30-32` says the job "is meant to become a required
  status check on the protect-master ruleset and is not one yet".
- `.github/workflows/migrations.yml:141-145` says it "must stay off the protect-master
  ruleset" while the link is broken.
- `.github/workflows/migrations.yml:450-451` already asserts the opposite in the present
  tense: "so it is a required status check on the protect-master ruleset". Today that
  sentence is simply wrong, and it contradicts the two above.
- `apps/website/app_docs/database/production-migrations.md:51` says both jobs "are
  intended to be required status checks".

**Solution:** Execute spec step 7 as a fetch, single-array `jq` edit, and whole-body PUT,
then make all four sentences agree in the plain present tense. The prose flip is not
cosmetic: it is the only part of this patch that lands in the diff, and it must not be
made true-on-paper before the ruleset is actually true.

**This patch is gated and the gate is not open yet.** The review request says so itself:
"This cannot be resolved on this branch alone while finding 2 is open." Re-verified:

- `gh run list --workflow=migrations.yml --limit 12` shows exactly one `workflow_dispatch`
  run, `35604160586`, and it is a **failure**. No `job=drift-check` dispatch has ever run,
  let alone gone green.
- `gh secret list` returns `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT_ID`,
  `OPENROUTER_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. There is no
  `SUPABASE_DB_URL`, so remediation B was not applied and all three prod-touching jobs
  still connect through `supabase link`.
- The workflow header at `:130-140` records why: the diagnose probe returned `200` on both
  Management API endpoints rather than the expected `200` then `403`, which falsified the
  hypothesis remediation B was drafted for, so no remediation was applied.

Step 1 below is therefore a hard precondition check, not a formality. If it fails, stop and
report; do not edit the ruleset and do not flip the prose. Requiring a check that dies at
`supabase link` on a ruleset with `bypass_actors: []` and `current_user_can_bypass: "never"`
locks `master` for everyone with no admin override, which is the single outcome the spec's
Notes forbid.

## Files to Modify

Use these files to implement the patch:

- `.github/workflows/migrations.yml` - three prose regions only, no job logic:
  `:30-32` (the job summary's "is meant to become ... and is not one yet"), `:141-145`
  (the "must stay off the protect-master ruleset" clause in the remediation paragraph),
  and `:450-451` (already present tense, confirm it now reads true and leave it).
- `apps/website/app_docs/database/production-migrations.md` - `:51`, "are intended to be
  required status checks" to plain present tense.

No file under `supabase/` and no job body changes. The ruleset edit is a GitHub API call,
not a file.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify the precondition, and stop if it is not met

All three must hold before anything else in this patch runs:

- `gh run list --workflow=migrations.yml --event=workflow_dispatch --limit 10` shows a
  **successful** `job=drift-check` run dispatched against current `master`'s state (the
  patch at `specs/patch/patch-adw-3874a012-run-diagnose-and-fix-link.md` owns producing it).
- `gh run list --workflow=migrations.yml --branch=master --limit 5` shows a green `push`
  run, i.e. the promotion in `specs/patch/patch-adw-3874a012-promote-and-prove-the-gate.md`
  landed and `20260921092000_grant_anon_select_documents.sql` reached prod.
- `prod-migration-sync` has reported a non-`skipped` green conclusion on a real PR into
  `master` (`gh pr checks <promotion-pr-number>`). A context that has never reported green
  cannot safely be made required.

If any one is unmet: make no ruleset call, make no prose edit, and report the specific
precondition that failed. A half-done version of this patch is worse than none, because
the prose would then claim a gate the ruleset does not enforce.

### Step 2: Add the two contexts to the `protect-master` ruleset

Fetch, edit one array, PUT the whole body back. Do not hand-write a body.

- Fetch: `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 > /tmp/ruleset-22536056.json`
- Keep that file as the rollback artefact for step 4.
- Edit only the one array, leaving `deletion`, `non_fast_forward` and `pull_request` rules,
  `strict_required_status_checks_policy: false` and `do_not_enforce_on_create: false`
  untouched:

  ```
  jq '(.rules[] | select(.type=="required_status_checks")
       | .parameters.required_status_checks) +=
      [{"context":"drift-check"},{"context":"prod-migration-sync"}]' \
    /tmp/ruleset-22536056.json > /tmp/ruleset-22536056-new.json
  ```

- Diff the two files before sending and confirm the only change is the two appended
  objects: `diff <(jq -S . /tmp/ruleset-22536056.json) <(jq -S . /tmp/ruleset-22536056-new.json)`
- PUT: `gh api -X PUT repos/SBub/issebya-homes-ai-system/rulesets/22536056 --input /tmp/ruleset-22536056-new.json`
- The contexts must be the **job ids** spelled character for character, `drift-check` and
  `prod-migration-sync`, since neither job sets a `name:`. A typo produces a context that
  never reports and blocks `master` permanently.
- The PUT needs repo admin. If it returns 403, the ruleset edit is an operator action:
  stop, leave the prose hedged, and hand the exact two commands above to a human with admin
  rights rather than flipping the prose on a promise.

### Step 3: Confirm all four contexts are present

- `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`
  must return `check`, `eval-gate`, `drift-check`, `prod-migration-sync`.
- `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '{enforcement,bypass_actors,rule_types:[.rules[].type]}'`
  must still return `enforcement: active`, `bypass_actors: []` and all four rule types, so
  the PUT preserved everything it was supposed to.
- Only once both pass does the prose become true. Proceed to step 4.

### Step 4: Flip the hedged prose to the present tense

`.github/workflows/migrations.yml`, the job summary at `:30-32`. Replace:

```
#     It is meant to become a required status check on the protect-master
#     ruleset and is not one yet; the diagnose verdict below says what is
#     still in the way.
```

with a plain statement that it is a required status check on the protect-master ruleset,
alongside drift-check, check and eval-gate.

`.github/workflows/migrations.yml`, the remediation paragraph at `:141-145`. The clause
"and the reason prod-migration-sync must stay off the protect-master ruleset. That ruleset
has `bypass_actors: []`, so requiring a check that cannot go green would lock master for
everyone with no admin override" no longer describes the state. Rewrite it so the
`bypass_actors: []` warning survives as the standing reason the link must never be allowed
to regress, rather than as a reason the job is not yet required. Keep every sentence about
the falsified 200-then-403 hypothesis and the next probe intact: those are still true and
are the record of what was learned.

`.github/workflows/migrations.yml:450-451` already reads "so it is a required status check
on the protect-master ruleset". Confirm it and leave it unchanged; after step 2 it is the
one sentence that was right all along.

`apps/website/app_docs/database/production-migrations.md:51`. Replace "Both
`prod-migration-sync` and `drift-check` are intended to be required status checks on the
`protect-master` ruleset" with "Both `prod-migration-sync` and `drift-check` are required
status checks on the `protect-master` ruleset". Leave the rest of the paragraph, including
the `paths:` and `if`-gate warnings, exactly as it is.

No em-dashes in any new prose. Use commas, colons or parentheses, matching the surrounding
lines.

### Step 5: Commit

- Conventional commit, `ci(migrations):` scope to match this file's four existing commits.
- No `Co-Authored-By` trailer.
- lefthook runs prettier, lint, typecheck and knip on the commit; the validation commands
  below are the same gates run ahead of it.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`
  - Returns all four contexts: `check`, `eval-gate`, `drift-check`, `prod-migration-sync`.
    This is the spec's own Validation Command and the definition of done for this patch.
- `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '[.rules[].type]'`
  - Still returns `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`,
    proving the PUT preserved every other rule.
- `yarn prettier --check .` - Formatting is clean, which is also the YAML syntax check for
  `.github/workflows/migrations.yml`.
- `yarn knip` - No unused files, exports or dependencies introduced.
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace whose docs
  directory this patch touches.
- `yarn turbo run typecheck --filter=./apps/website` - No incidental TypeScript breakage.
- `yarn turbo run test --filter=./apps/website` - Unit tests pass.
- `grep -n "intended to be required" apps/website/app_docs/database/production-migrations.md .github/workflows/migrations.yml`
  - Returns nothing.
- `grep -n "is not one yet\|must stay off the protect-master" .github/workflows/migrations.yml`
  - Returns nothing.

## Patch Scope

**Lines of code to change:** roughly 10 lines of comment and markdown prose across two
files, plus one `gh api` PUT that changes no file in the repo.

**Risk level:** high. Not because of the diff size, but because of what the PUT does: on a
ruleset with `bypass_actors: []` and `current_user_can_bypass: "never"`, a required context
that cannot report green blocks every merge into `master` with no admin override. The step 1
precondition check and the step 3 read-back are the whole mitigation, and step 2 keeps the
pre-PUT body at `/tmp/ruleset-22536056.json` so the change can be reverted by PUTting the
original back.

**Testing required:** no automated test, per the spec's Test Coverage section: this is a
repository setting plus two prose edits, and none of the repo's three test layers can read
a ruleset. The proof is the step 3 read-back plus the separate deliberate-failure PR that
`specs/patch/patch-adw-3874a012-promote-and-prove-the-gate.md` owns, which is what
demonstrates the now-required check actually blocks a merge.
