# Patch: add `drift-check` and `prod-migration-sync` to the `protect-master` ruleset

## Metadata

adw_id: `3874a012`
review_change_request: `Issue #2: Step 7 was not done, so the chore's headline deliverable (the issue title is literally 'make prod migration sync a required check for merges to master') is absent. The spec's own Validation Command `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`returns`[{"context":"check"},{"context":"eval-gate"}]`, not the four contexts it is specified to return; `drift-check`and`prod-migration-sync`are absent. The implementer was right not to pull this forward while the link 403 is unfixed (with`bypass_actors: []`and`current_user_can_bypass: "never"`, requiring a check that always fails would lock master for everyone, exactly as the spec's Notes warn), and the doc wording was honestly hedged to 'intended to be required status checks' to match. But the consequence stands: merging this branch ships a job that gates nothing, and the behavioural acceptance criterion ('a PR into master with an unapplied local migration or a failing link cannot merge') is false. Resolution: This is unblocked only by finding 1. Once a dispatched `job=drift-check`is green against current master, do step 7 on the ruleset: fetch`gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056`, edit only the `required_status_checks`array with`jq`to add`{"context":"drift-check"}`and`{"context":"prod-migration-sync"}`alongside the existing`check`and`eval-gate`, and PUT the whole body back so the `deletion`, `non_fast_forward`and`pull_request`rules,`strict_required_status_checks_policy: false`and`do_not_enforce_on_create: false`are preserved verbatim. The contexts must match the job ids exactly, since neither job sets a`name:`. Re-read the ruleset afterwards and confirm all four are present. Then change `apps/website/app_docs/database/production-migrations.md` from 'are intended to be required status checks' to the plain present tense the spec's step 9 asks for. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`

**Issue:** Spec step 7 was never executed. The `protect-master` ruleset (id `22536056`)
still requires only `check` and `eval-gate`, verified live:

```
$ gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
    --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'
[{"context":"check"},{"context":"eval-gate"}]
```

The chore therefore ships a `prod-migration-sync` job that gates nothing, and the issue's
behavioural acceptance criterion ("a PR into master with an unapplied local migration or a
failing link cannot merge") is false. The doc at
`apps/website/app_docs/database/production-migrations.md:51` is hedged to "are intended to
be required status checks" to match that reality, and the workflow header at
`.github/workflows/migrations.yml:30-31` and `:143` says the same in two more places.

**Solution:** Execute spec step 7 verbatim, then flip the three hedged sentences to plain
present tense. The ruleset edit is a fetch, a single-array `jq` edit, and a PUT of the whole
body, so every other rule and parameter survives unchanged.

**This patch is gated, and the gate is not open yet.** The review request says so itself:
"This is unblocked only by finding 1." Finding 1's patch
(`specs/patch/patch-adw-3874a012-run-diagnose-and-fix-link.md`) is only half executed. Its
step 1 ran (diagnose run `35604160586`, 2026-09-21) and the result **falsified** the
hypothesis the remediation was drafted for: both Management API endpoints returned `200`,
not the expected `200` then `403`, yet `supabase link --project-ref` still failed in the
same run with the 2026-09-10 message. Remediation B was correctly not applied, because
swapping the connection mechanism of three prod-touching jobs without knowing which call
breaks is a guess rather than a fix. Consequently:

- `supabase link` is still on the critical path of `push`, `drift-check` and
  `prod-migration-sync` (`.github/workflows/migrations.yml:323`, `:364`, `:504`).
- No `job=drift-check` dispatch has ever run. `gh run list --workflow=migrations.yml
--event=workflow_dispatch` returns exactly one row, the failed diagnose probe.
- With `bypass_actors: []` and `current_user_can_bypass: "never"`, performing the PUT today
  would require two checks that currently cannot go green, locking `master` for everyone
  with no admin override. That is the precise outcome the spec's Notes and the review
  request both warn against.

Step 1 below is therefore a hard precondition check with an explicit abort. Steps 2 to 5 are
the patch proper and run only once step 1 passes.

## Files to Modify

Use these files to implement the patch:

- **The `protect-master` ruleset** (`repos/SBub/issebya-homes-ai-system/rulesets/22536056`),
  via the GitHub API. Not a file in the repo, but it is the patch's primary artefact.
- `apps/website/app_docs/database/production-migrations.md` - line 51, "are intended to be
  required status checks" becomes "are required status checks".
- `.github/workflows/migrations.yml` - the two header sentences that assert the same hedge
  (`:30-31` and `:143`) become statements of fact. Line `450-451` already reads "so it is a
  required status check on the protect-master ruleset" and needs no edit; it simply stops
  being false.

No other files. `docs/conditional-docs.md` already carries the widened conditions spec step 9
asks for (`:100-106`), so it is untouched.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify the precondition, and stop if it is not met

Do not proceed on assumption. Establish all three of these, in this order:

1. `supabase link` is no longer on the critical path, or is working. Check with
   `grep -n "supabase link\|--linked" .github/workflows/migrations.yml` and confirm the only
   remaining hits are inside the `diagnose` job (currently false: `:323`, `:364`, `:504`,
   `:415`, `:541` are all outside it).
2. A dispatched `drift-check` run exists and is green against current `master`:
   ```
   gh run list --workflow=migrations.yml --event=workflow_dispatch --limit 10
   ```
   must show a `job=drift-check` row with conclusion `success`. If none exists, dispatch one
   (`gh workflow run migrations.yml --ref develop -f job=drift-check`, then `gh run watch`)
   and use its result.
3. `prod-migration-sync` has reported green on a real PR into `master`, which is spec step 6.
   `gh pr checks <promotion-pr-number>` shows it as `pass`, not `skipped`.

**If any of the three fails, abort this patch and report the blocker rather than proceeding.**
The PUT in step 2 is the point of no return: the ruleset has no bypass actors, so a required
check that cannot go green blocks every merge into `master` permanently, with no admin
override and no way to undo it through the merge button. Making the gate real is worth
nothing if it makes the repository unmergeable. Report exactly which of the three conditions
is unmet and what run id demonstrates it.

The current state of that check, as of writing: condition 1 fails, condition 2 fails,
condition 3 fails. Finding 1 must land first.

### Step 2: Extend the ruleset's `required_status_checks` array

Fetch, edit one array, PUT the whole body back. Do not hand-write a body.

- Capture the current state first, so the change is reversible:
  ```
  gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
    > /tmp/ruleset-22536056-before.json
  ```
- Build the PUT body. The GET response carries read-only fields the PUT endpoint does not
  accept (`id`, `node_id`, `source`, `source_type`, `created_at`, `updated_at`, `_links`,
  `current_user_can_bypass`), so select the six writable ones and rewrite only the one array:
  ```
  jq '{name, target, enforcement, bypass_actors, conditions,
       rules: [ .rules[]
                | if .type == "required_status_checks"
                  then .parameters.required_status_checks +=
                       [{"context":"drift-check"},{"context":"prod-migration-sync"}]
                  else . end ]}' \
     /tmp/ruleset-22536056-before.json > /tmp/ruleset-22536056-put.json
  ```
  Because the `rules` array is mapped rather than rebuilt, the `deletion`,
  `non_fast_forward` and `pull_request` rules pass through untouched, and within
  `required_status_checks` both `strict_required_status_checks_policy: false` and
  `do_not_enforce_on_create: false` are preserved verbatim, as are the existing `check` and
  `eval-gate` entries. `bypass_actors: []` and the `refs/heads/master` condition likewise.
- Eyeball the body before sending it:
  ```
  diff <(jq -S '{name,target,enforcement,bypass_actors,conditions,rules}' \
           /tmp/ruleset-22536056-before.json) \
       <(jq -S . /tmp/ruleset-22536056-put.json)
  ```
  The only difference must be the two added context objects. Anything else means the `jq`
  filter is wrong; fix it rather than sending it.
- Send it:
  ```
  gh api --method PUT repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
    --input /tmp/ruleset-22536056-put.json
  ```
- The two contexts must be spelled `drift-check` and `prod-migration-sync`, matching the
  **job ids** at `.github/workflows/migrations.yml:328` and `:444` character for character.
  Neither job sets a `name:`, so the job id is the context GitHub reports. A typo produces a
  context that never reports and blocks `master` permanently.

### Step 3: Re-read the ruleset and confirm all four contexts

This is the spec's own Validation Command, and the one the review request quotes:

```
gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
  --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'
```

Expected: `[{"context":"check"},{"context":"eval-gate"},{"context":"drift-check"},{"context":"prod-migration-sync"}]`.

Also confirm nothing else moved:

```
gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 \
  --jq '[.rules[].type], .bypass_actors, .enforcement, .conditions'
```

Expected: `["deletion","non_fast_forward","pull_request","required_status_checks"]`, `[]`,
`"active"`, and `refs/heads/master`. If any of those changed, restore immediately by PUTting
the six writable fields of `/tmp/ruleset-22536056-before.json` back.

### Step 4: Flip the doc to present tense

In `apps/website/app_docs/database/production-migrations.md:51`, change:

```
Both `prod-migration-sync` and `drift-check` are intended to be required status
checks on the `protect-master` ruleset, ...
```

to:

```
Both `prod-migration-sync` and `drift-check` are required status checks on the
`protect-master` ruleset, ...
```

Rewrap the paragraph to the file's existing width. Change nothing else in it: the sentences
that follow, about `paths:` filters and `if` gates on the `changes` job, are already correct
and are what make the statement safe.

### Step 5: Remove the same hedge from the workflow header

The header asserts the hedge in two more places, and leaving them contradicts the ruleset the
patch just changed.

- `.github/workflows/migrations.yml:30-31`, in the `prod-migration-sync` bullet: "It is meant
  to become a required status check on the protect-master ruleset and is not one yet; the
  diagnose verdict below says what is still in the way." Replace with a plain statement that
  it is a required status check on that ruleset, and record the date and the run id that
  demonstrated it green before the ruleset was changed.
- `.github/workflows/migrations.yml:143`: "... and the reason prod-migration-sync must stay
  off the protect-master ruleset. That ruleset has `bypass_actors: []`, so requiring a check
  that cannot go green would lock master for everyone with no admin override." The sentence
  is now historical. Keep the `bypass_actors: []` warning, since it is the durable reason
  ordering matters here and the next person needs it, but reframe it as why the gate was
  added only after the check reported green rather than as a reason it is still off.
- Keep the file's house style, which is reasoned prose in comment blocks rather than bullet
  lists. Do not touch `:450-451`; it already reads as fact and now is one.

## Validation

Execute every command to validate the patch is complete with zero regressions.

1. `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`
   - Returns all four contexts: `check`, `eval-gate`, `drift-check`, `prod-migration-sync`.
     This is the review request's own check and the patch's primary acceptance test.
2. `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '[.rules[].type], .bypass_actors, .enforcement'`
   - Returns the four rule types unchanged, `[]`, and `"active"`. Proves the PUT preserved
     everything outside the one array.
3. `grep -n "intended to be required" apps/website/app_docs/database/production-migrations.md .github/workflows/migrations.yml` and
   `grep -n "is not one yet\|must stay off the protect-master" .github/workflows/migrations.yml`
   - Both return nothing. Every hedged claim is gone.
4. `yarn prettier --check .` - Formatting matches the repo config, so the lefthook commit hook
   will not reject it. This also parses `.github/workflows/migrations.yml`, so a malformed
   workflow fails here rather than on a runner.
5. `yarn knip` - No unused files, exports or dependencies introduced.
6. `yarn turbo run lint --filter=./apps/website` and
   `yarn turbo run typecheck --filter=./apps/website` and
   `yarn turbo run test --filter=./apps/website`
   - Lint, types and unit tests pass, proving the markdown and YAML edits caused no
     regression in the one workspace this patch touches.
7. `gh pr checks <this-pr-number>` - The branch's own PR still merges. This PR targets
   `develop`, which the `protect-master` ruleset does not cover, so the new contexts must not
   appear as required on it. If they do, the ruleset's `conditions.ref_name.include` was
   damaged by the PUT; restore from `/tmp/ruleset-22536056-before.json`.

## Out of scope

- **Spec step 8**, proving the gate blocks by opening a throwaway PR into `master` that
  deletes a migration prod holds. The review request does not ask for it, and it is a
  separate deliberate-failure exercise that needs its own branch and its own cleanup.
- **Finding 1's remaining work**, the narrowing probe on `/v1/projects/{ref}/api-keys?reveal=true`
  and whatever remediation it indicates. That is the other patch, and this one is gated on it.
- The `eval-gate`-behind-a-`paths:`-filter problem the spec's Notes flag. Pre-existing, out of
  scope, worth its own issue.

## Patch Scope

**Lines of code to change:** roughly 10 to 15 lines. One line in
`production-migrations.md` (plus rewrap), and two short header passages in
`migrations.yml`. The ruleset change is an API call, not a diff.

**Risk level:** high, and entirely concentrated in step 2. The edit itself is three lines of
`jq`, but its effect is irreversible through normal means: `protect-master` has
`bypass_actors: []` and `current_user_can_bypass: "never"`, so requiring a check that cannot
report green blocks every merge into `master` for everyone. The step 1 precondition gate and
the `/tmp/ruleset-22536056-before.json` capture exist for that reason and must not be skipped.
The markdown and YAML edits in steps 4 and 5 are prose only and carry no risk.

**Testing required:** No automated test. The change is a repository ruleset setting plus
comment and documentation prose, none of which any of this repo's three test layers (all
inside `apps/website`, all exercising application code) can reach. The real verification is
validation commands 1 to 3 against the live ruleset, with commands 4 to 6 proving no
regression elsewhere. Do not run `supabase start`, `supabase db reset`, or any local database
reset: the repository runs a single shared local instance.
