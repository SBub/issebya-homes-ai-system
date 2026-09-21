# Patch: run the diagnose probe and apply the link remediation it indicates

## Metadata

adw_id: `3874a012`
review_change_request: `Issue #1: Steps 3 and 4 were not executed, so the `supabase link`403 that the whole chore exists to repair is still unfixed, and the new gate cannot go green.`gh run list --workflow=migrations.yml --event=workflow_dispatch`returns zero rows: neither the`job=diagnose`probe nor the`job=drift-check`run the spec requires was ever dispatched, from this branch or any other. Consistent with that, the workflow header still ends the hypothesis paragraph with 'Until diagnose has run, push and drift-check both fail at the link step' instead of the verdict-plus-run-id that step 3 requires, and no remediation was applied:`prod-migration-sync`still connects with`supabase link --project-ref`+`--linked`(lines 425 and 471),`gh secret list`shows no`SUPABASE_DB_URL`, so remediation B was not taken either. The only observed execution of that link step, run 34486392180, failed with the 403. Two of the spec's Validation Commands (`gh workflow run migrations.yml --ref develop -f job=diagnose`and the same with`job=drift-check`) are therefore unrun, and the job's own comment calls its no-`continue-on-error`link step 'the single most load-bearing line in the job' — which means on the first real PR into master this check fails for a credentials reason, not a migration reason. Resolution: Part of this cannot be patched on this branch alone: remediation A (minting a replacement Supabase PAT) and remediation B (adding the`SUPABASE_DB_URL`repo secret) both need a human with Supabase org and repo-secret access. What can and should be done on this branch first is step 3: dispatch`gh workflow run migrations.yml --ref chore/issue-89-adw-3874a012-require-prod-migration-sync -f job=diagnose`(the spec explicitly allows dispatching from the chore branch),`gh run watch`it, and write the observed CLI version and the two HTTP status codes into the workflow header, replacing the 'Until diagnose has run' sentence with the verdict and the run id. Then apply the remediation the probe indicates. If it is the expected 200-then-403 on`/api-keys`, implement remediation B on this branch: delete the `Link to prod project`step from`push`, `drift-check`and`prod-migration-sync`, replace `--linked`with`--db-url "$SUPABASE_DB_URL"`on every`supabase db push`and`supabase migration list`call, update the header's Secrets paragraph to say why`link`was abandoned, and hand the secret creation (session-pooler host, port 5432, percent-encoded password) to the operator as an explicit prerequisite. Re-dispatch`job=drift-check` and confirm green before anything in step 7 is touched. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`

**Issue:** Steps 1, 2 and 5 of the spec landed (header corrections, the `diagnose`
dispatch arm, the `prod-migration-sync` job), but steps 3 and 4 were skipped entirely.
Verified against the live repo:

- `gh run list --workflow=migrations.yml --event=workflow_dispatch` returns zero rows.
  The probe the whole chore is built around has never run, from any branch.
- `.github/workflows/migrations.yml:108` still closes the hypothesis paragraph with
  "Until diagnose has run, push and drift-check both fail at the link step", the exact
  sentence step 3 requires be replaced by a verdict plus a run id.
- `gh secret list` returns `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT_ID`,
  `OPENROUTER_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. No
  `SUPABASE_DB_URL`, so remediation B was not taken.
- All three prod-touching jobs still connect through `supabase link --project-ref` and
  `--linked`: `push` (link at :266, `db push` at :269), `drift-check` (link at :307,
  `db push --dry-run` at :344, `migration list --linked` at :358), and
  `prod-migration-sync` (link at :447, `migration list --linked --output-format json`
  at :484).

The consequence is the blocker: `prod-migration-sync` is the job the chore exists to add
as a required check, its link step carries no `continue-on-error` by deliberate design
("the single most load-bearing line in the job", :443-446), and the only ever observed
execution of that link step is run `34486392180`, which died on the 403. On the first
real PR into `master` this required check therefore fails for a credentials reason
rather than a migration reason. Step 7 of the spec (adding it to the `protect-master`
ruleset, which has `bypass_actors: []` and `current_user_can_bypass: "never"`) would
then lock `master` for everyone with no admin override.

**Solution:** Execute spec steps 3 and 4 in order. Dispatch the `diagnose` probe, record
its verdict in the workflow header, then apply the remediation the probe indicates. If
the probe shows the expected `200` on `/v1/projects/{ref}` and `403` on
`/v1/projects/{ref}/api-keys`, implement remediation B: take the Management API off the
critical path by replacing `link` plus `--linked` with a direct `--db-url` connection in
`push`, `drift-check` and `prod-migration-sync`.

**Explicitly out of scope, and requires a human operator.** Two actions in this patch
cannot be performed from this branch and must be handed over rather than attempted:

- Creating the `SUPABASE_DB_URL` repo secret (needs Supabase project database credentials).
- Minting a replacement Supabase personal access token, if the probe points at
  remediation A instead (needs ownership of the `issebya` Supabase org).

The YAML changes land on this branch either way. The patch is complete when the workflow
is remediated and the operator prerequisite is stated; the green `drift-check` that
unblocks spec step 7 lands once the operator has created the secret.

**Also out of scope:** spec steps 6, 7, 8 and 9. Step 4 ends at "re-dispatch
`job=drift-check` and confirm it goes green", which is the precondition for step 6. The
review request says the same: "confirm green before anything in step 7 is touched."

## Files to Modify

- `.github/workflows/migrations.yml` - the only file. Header hypothesis paragraph
  (verdict + run id), header Secrets paragraph (why `link` was abandoned), and the
  connection mechanism in the `push`, `drift-check` and `prod-migration-sync` jobs.

No other file changes. The `diagnose` job is not modified: it probes the Management API,
so it keeps `SUPABASE_ACCESS_TOKEN`, `supabase link`, and its interpretation guide intact
for the next time credentials break.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Dispatch the `diagnose` probe and capture its output

- Confirm the branch is pushed: this work is PR #104 into `develop`, head
  `chore/issue-89-adw-3874a012-require-prod-migration-sync`, commit `028d311`.
- Dispatch from the chore branch, which the spec explicitly permits:
  ```
  gh workflow run migrations.yml \
    --ref chore/issue-89-adw-3874a012-require-prod-migration-sync \
    -f job=diagnose
  ```
- GOTCHA, and the reason this is step 1 rather than a one-liner. The repo's default
  branch is `develop`, and `origin/develop`'s copy of this workflow lists only
  `drift-check` and `push` under the `job` input's `options` (verified:
  `git show origin/develop:.github/workflows/migrations.yml` at its lines 121-129).
  GitHub registers the `workflow_dispatch` trigger from the default branch. If the
  dispatch is rejected for an unrecognised input value, do not work around it by editing
  the trigger. Merge PR #104 into `develop` first, then dispatch the spec's own
  Validation Command verbatim:
  `gh workflow run migrations.yml --ref develop -f job=diagnose`. Both routes run the
  same probe; record which one was used.
- Get the run id and watch it:
  ```
  gh run list --workflow=migrations.yml --event=workflow_dispatch --limit 1
  gh run watch <run-id>
  gh run view <run-id> --log
  ```
- Record three observations verbatim from the log, and nothing else:
  1. The `supabase --version` output from the "Which CLI actually got installed" step.
     This is the first direct observation of the installed version; the header's
     2.116.0-versus-2.117.0 story is currently inferred from release dates.
  2. The two status codes printed by "Probe the two Management API endpoints `link`
     calls": `GET /v1/projects/<ref>` and `GET /v1/projects/<ref>/api-keys`.
  3. Whether the final "Attempt the link that fails" step failed, and its message.
- Confirm no secret material reached the log. The probe uses
  `curl -s -o /dev/null -w '%{http_code}'` specifically so the `/api-keys` response body
  (which contains live anon and service-role keys) is discarded. If a body did leak,
  stop, delete the run log (`gh run delete <run-id>`), and rotate the keys before
  continuing.

### Step 2: Write the verdict into the workflow header

Edit the hypothesis paragraph in `.github/workflows/migrations.yml` (the block ending at
:106-108). Replace the sentence:

```
# endpoint is now gated" without anyone having to copy a repo secret onto
# a laptop to curl by hand. Until diagnose has run, push and drift-check
# both fail at the link step: a real outstanding problem, not a quirk of
# these jobs.
```

with the observed result: the run id, the CLI version the probe reported, both status
codes, and what that settles. Keep the file's house style, which is reasoned prose rather
than bullet points. The paragraph must state the verdict plainly enough that the next
person does not re-run the probe to learn it. For the expected outcome that reads roughly:
diagnose run `<id>` (`<date>`) confirmed the hypothesis on CLI `<version>`, `200` on
`/v1/projects/{ref}` and `403` on `/v1/projects/{ref}/api-keys`, so the account still
resolves the project and is refused only the key fetch `link` performs afterwards. The
token is not dead, and no CLI pin can fix an endpoint that now demands a higher org role.

### Step 3: Apply the remediation the probe indicates

Take exactly one branch, determined by step 1's status codes. The interpretation guide
printed by the `diagnose` job itself (`:632-652`) is the authority here.

**If `401` on either probe, remediation A.** The token is dead or malformed. This is
operator work and no YAML changes: mint a replacement personal access token on an account
that owns the `issebya` org, `gh secret set SUPABASE_ACCESS_TOKEN`, re-dispatch
`job=diagnose`. If it goes green, record that in the header, skip to step 5, and leave
every job's connection mechanism alone. If it still `403`s on `/api-keys`, A is
falsified: do B.

**If `403` on both probes**, the account lacks project access outright, which contradicts
`supabase projects list` succeeding in the same run. Do not proceed to B. Record the
contradiction in the header and hand back to the operator to re-check which org the token
belongs to.

**If both probes `200` but `link` still failed**, the fault is CLI-side. Record it in the
header, add the finding to https://github.com/supabase/cli/issues/6392, and stop: the
spec's step 4 does not cover this branch and it needs a fresh decision.

**If `200` then `403`, remediation B.** This is the expected outcome and the one the
review request anticipates. Edit `.github/workflows/migrations.yml`:

- **`push` job.** Replace the `SUPABASE_ACCESS_TOKEN` entry in its `env:` block (:248)
  with `SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}`. Delete the `Link to prod
project` step (:265-266). Change `supabase db push` (:269) to
  `supabase db push --db-url "$SUPABASE_DB_URL"`.
- **`drift-check` job.** Same `env:` swap (:285). Delete its `Link to prod project` step
  (:306-307). Change `supabase db push --dry-run` (:344) to
  `supabase db push --dry-run --db-url "$SUPABASE_DB_URL"` and
  `supabase migration list --linked` (:358) to
  `supabase migration list --db-url "$SUPABASE_DB_URL"`. The `::group::` labels on
  :343 and :357 name the commands they wrap, so update those strings to match.
- **`prod-migration-sync` job.** Same `env:` swap (:411). Delete its `Link to prod
project` step (:442-447), and move that step's comment about connection failure being
  fatal onto the `migration list` call instead, because that is now the step where a bad
  connection surfaces. It must not acquire `continue-on-error`; a gate that goes green
  when it cannot reach what it gates is worse than no gate. Change
  `supabase migration list --linked --output-format json` (:484) to
  `supabase migration list --db-url "$SUPABASE_DB_URL" --output-format json`.
  The existing `list_rc` / `jq_rc` guard at :508-512 already turns a failed connection
  into an explicit error and `exit 1`, so the fatal-on-failure property is preserved
  through a different mechanism rather than lost. Say that in the comment.
- **Do not touch the `diagnose` job.** It probes the Management API by design, so it
  keeps `SUPABASE_ACCESS_TOKEN`, its `supabase link` attempt, and its interpretation
  guide. That guide's "200 then 403" entry currently describes this remediation in the
  future tense; reword it to past tense, pointing at the header for what was done.
- **Header Secrets paragraph** (:66-69). It currently reads "push, drift-check and
  prod-migration-sync all need SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF repo
  secrets. Both exist, and both predate the last successful push on 2026-08-28." Rewrite
  it to say those three jobs now need `SUPABASE_DB_URL`, that `SUPABASE_ACCESS_TOKEN` and
  `SUPABASE_PROJECT_REF` remain only for `diagnose`, and why `link` was abandoned. The
  reason is the load-bearing part and the spec is specific about it: not because the 403
  was mysterious, but because a required check must not be breakable by a third-party
  privilege change this repo cannot influence. Document the secret's required shape in
  the same paragraph, both gotchas included:
  `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`,
  session mode on port 5432 rather than transaction mode on 6543 because migrations need
  session-level statements, and the pooler host rather than `db.<ref>.supabase.co`
  because that direct host is IPv6-only while GitHub-hosted runners are IPv4-only. Note
  that the password must be percent-encoded.

### Step 4: Hand the secret creation to the operator

`SUPABASE_DB_URL` cannot be created from this branch. State it as an explicit blocking
prerequisite on PR #104, so it is not discovered at merge time:

- What to run: `gh secret set SUPABASE_DB_URL`, with the session-pooler connection string
  in the shape documented in the header.
- Where the value comes from: the Supabase dashboard, Project Settings, Database,
  Connection string, Session pooler.
- The two gotchas that will otherwise each cost a debugging round: port 5432 not 6543,
  and percent-encode the password.
- Why it blocks: `push`, `drift-check` and `prod-migration-sync` all read it after step 3.
  Until it exists, all three fail, and `prod-migration-sync` is about to become a required
  check on a ruleset with no bypass actors.

### Step 5: Re-dispatch `drift-check` and confirm green

This is the precondition for spec step 6, and nothing in spec step 7 may be touched
before it passes.

- `gh workflow run migrations.yml --ref develop -f job=drift-check`, then
  `gh run watch <run-id>`.
- Expected: green, reporting no drift. `master`'s newest migration is
  `20260828120000_grant_service_role_all_public.sql` and prod holds it, so the two sides
  agree.
- If it reports drift on `20260921092000_grant_anon_select_documents.sql`, that is not a
  failure of this patch. That migration is on `develop` only, and `drift-check` pins
  `ref: master`, so it should not appear. If it does, the checkout pin is wrong and that
  is a separate defect to report rather than patch around here.
- Record the green run id in the workflow header alongside the diagnose verdict from
  step 2. The header is this incident's record, and "the fix was verified by run `<id>`"
  is the part that stops the next person re-deriving it.

## Validation

Execute every command. The first five are the spec's own Validation Commands minus the
ones covering out-of-scope steps 6 to 9.

1. `yarn prettier --check .` - Formatting matches the repo config so the lefthook commit
   hook will not reject it. This is also the YAML syntax check: Prettier parses
   `.github/workflows/migrations.yml`, so a malformed workflow fails here rather than on
   a runner.
2. `yarn knip` - No unused files, exports or dependencies introduced.
3. `yarn turbo run lint --filter=./apps/website` - Lint still passes.
4. `yarn turbo run typecheck --filter=./apps/website` - No incidental TypeScript breakage.
5. `yarn turbo run test --filter=./apps/website` - Unit tests pass, proving zero
   regressions.
6. `gh run list --workflow=migrations.yml --event=workflow_dispatch --limit 5` - Now
   returns rows rather than nothing. At minimum the `diagnose` run from step 1 and the
   `drift-check` run from step 5.
7. `gh run view <diagnose-run-id> --log | grep -c "sbp_"` - Returns 0. No token material
   reached the log.
8. `grep -n "supabase link\|--linked" .github/workflows/migrations.yml` - After
   remediation B, the only remaining hits are inside the `diagnose` job.
9. `grep -n "Until diagnose has run" .github/workflows/migrations.yml` - Returns nothing.
   The sentence the review flagged is gone, replaced by the verdict and the run id.

## Patch Scope

**Lines of code to change:** roughly 40 to 60 lines of `.github/workflows/migrations.yml`
under remediation B: about 20 lines of header prose rewritten across two paragraphs,
three 2-line `Link to prod project` steps deleted, three `env:` entries swapped, five CLI
invocations given `--db-url`, and the comment moves that keep the fatal-on-connection-
failure reasoning attached to the step that now carries it. Under remediation A, header
prose only.

**Risk level:** medium. The YAML edit itself is mechanical and Prettier syntax-checks it.
The risk lives in ordering and in the operator handoff. After step 3, all three
prod-touching jobs depend on a secret that does not yet exist, so they fail until the
operator creates it. That is safe only because `prod-migration-sync` is not yet a
required check. Spec step 7 must not be pulled forward: the `protect-master` ruleset has
`bypass_actors: []` and `current_user_can_bypass: "never"`, so requiring a check that
cannot go green locks `master` with no admin override.

**Testing required:** No automated test, for the reason the spec's Test Coverage section
already argues: the change is workflow YAML that only executes on a GitHub runner, and
all three of this repo's test layers live inside `apps/website` and exercise application
code. The real test is the two dispatched runs, `diagnose` in step 1 and `drift-check` in
step 5, plus validation commands 1 to 5 proving no regression elsewhere. Do not run
`supabase start`, `supabase db reset`, or any local database reset: the repo runs a
single shared local instance.
