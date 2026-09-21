# Patch: add the reveal-probe diagnose arm, compare 2.117.0, and remediate the link

## Metadata

adw_id: `3874a012`
review_change_request: `Issue #2: Spec step 4 (apply the remediation the probe indicates) was not executed, so the supabase link 403 the whole chore exists to repair is still live and every prod-touching job still fails at its connect step. The diagnose probe did run (35604160586) and I verified its log directly: 200 on /v1/projects/{ref}, 200 on /api-keys, then supabase link --project-ref failing with 'Your account does not have the necessary privileges to access this endpoint.' Neither of step 4's two branches matches that outcome - remediation A wanted a 401 and remediation B wanted a 403 on /api-keys - and the header argues, defensibly, that swapping the connection mechanism of three prod-touching jobs without knowing which call breaks would be a guess rather than a fix. But the workflow's own interpretation guide prescribes a concrete next action for exactly the 200-then-200 branch that was observed (probe /v1/projects/{ref}/api-keys?reveal=true, and bump the pin to 2.117.0 on a throwaway branch and re-dispatch diagnose to compare), and neither was done. Step 3's second half was also skipped: gh run list --workflow=migrations.yml shows exactly one workflow_dispatch run ever, the diagnose one, so the spec's Validation Command gh workflow run migrations.yml --ref develop -f job=drift-check was never run - I did not dispatch it myself, since it is a CI write against prod credentials whose outcome (failure at link) is already established, so the spec's 'drift-check connects and reports no drift' criterion is unverified rather than failed. The job's own comment calls its no-continue-on-error link step 'the single most load-bearing line in the job', which means on the first real PR into master this check fails for a credentials reason, not a migration reason. Resolution: Part of this needs a human with Supabase org and repo-secret access and cannot be patched from the branch alone. On the branch: add the third diagnose arm the header already names, GET /v1/projects/{ref}/api-keys?reveal=true, printing status code only (never the body - it returns live anon and service-role keys), and dispatch gh workflow run migrations.yml --ref chore/issue-89-adw-3874a012-require-prod-migration-sync -f job=diagnose. Separately bump the supabase/setup-cli pin to 2.117.0 on a throwaway branch and dispatch diagnose there to compare. Write both results into the header next to the existing verdict, and post them to https://github.com/supabase/cli/issues/6392. If the reveal probe 403s, implement remediation B as drafted: have the operator add a SUPABASE_DB_URL repo secret (session-pooler host, port 5432, percent-encoded password - the direct db.<ref>.supabase.co host is IPv6-only and GitHub runners are IPv4-only), delete the Link to prod project step from push, drift-check and prod-migration-sync, and replace --linked with --db-url "$SUPABASE_DB_URL" on every supabase db push and supabase migration list call, updating the header's Secrets paragraph to say why link was abandoned. Whatever the fix, finish by dispatching job=drift-check and confirming it is green against current master before anything in finding 1 is touched. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`

**Issue:** Spec step 3's first half landed (diagnose ran as `35604160586`, its verdict is
written into the workflow header at `.github/workflows/migrations.yml:112-151`), but the
chore stopped there. Three things the header itself prescribes were not done:

- The third probe arm it names, `GET /v1/projects/{ref}/api-keys?reveal=true`, was never
  added. Lines 147-151 and the interpretation guide at lines 710-717 both call for it as
  the next narrowing step after the observed 200-then-200 result.
- The 2.117.0 comparison run on a throwaway branch was never dispatched. Lines 148-149
  and 714-716 call for it; the header notes at 190-198 that a throwaway branch is
  dispatchable without merging, so nothing blocked it.
- Spec step 3's second half, `gh workflow run migrations.yml -f job=drift-check`, was
  never dispatched. Exactly one `workflow_dispatch` run exists on this workflow.

The consequence is the blocker. All three prod-touching jobs still connect through
`supabase link --project-ref` plus `--linked`: `push` (link at :322-323, `db push` at
:326), `drift-check` (link at :363-364, `db push --dry-run` at :401,
`migration list --linked` at :415), `prod-migration-sync` (link at :499-504,
`migration list --linked --output-format json` at :541). That last link step carries no
`continue-on-error` by deliberate design, described in its own comment as "the single
most load-bearing line in the job", so on the first real PR into `master` the check the
chore exists to add fails for a credentials reason rather than a migration reason.

**Solution:** Execute the header's own prescribed next move, then remediate on what it
shows. Add the `?reveal=true` arm to `diagnose`, dispatch it from this chore branch,
dispatch the same probe from a throwaway branch pinned to 2.117.0, write both results
into the header beside the existing verdict, and report them upstream. If the reveal
probe returns 403, that confirms the privileged-key-fetch hypothesis and remediation B
from spec step 4 is applied: `link` plus `--linked` is replaced by a direct
`--db-url "$SUPABASE_DB_URL"` connection in all three prod-touching jobs.

**Explicitly out of scope, and requires a human operator.** Two actions cannot be
performed from this branch and must be handed over rather than attempted:

- Creating the `SUPABASE_DB_URL` repo secret. Needs the Supabase project's database
  password and the session-pooler host, which only an org owner can read.
- Minting a replacement Supabase personal access token, should the reveal probe come
  back 401 instead (remediation A).

The YAML changes land on this branch either way. The green dispatched `drift-check` that
closes this patch lands once the operator has created the secret; until then that single
validation step stays open and must be reported as open rather than assumed.

**Also out of scope:** spec steps 6, 7, 8 and 9, and finding 1 (the ruleset change). The
review request is explicit: confirm a green `drift-check` "before anything in finding 1
is touched". The `protect-master` ruleset has `bypass_actors: []` and
`current_user_can_bypass: "never"`, so requiring a check that cannot go green locks
`master` for everyone with no admin override.

## Files to Modify

Use these files to implement the patch:

- `.github/workflows/migrations.yml` - the only file changed. Three edit sites: the
  `diagnose` job's probe step (new `?reveal=true` arm and an updated interpretation
  guide), the header block (the new results written beside the existing verdict at
  :112-151, and the Secrets paragraph at :68-70 if remediation B is applied), and the
  connect steps of `push`, `drift-check` and `prod-migration-sync` if remediation B is
  applied.

No new files. No documentation changes: spec step 9 is out of scope here.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `?reveal=true` arm to the `diagnose` probe step

In `.github/workflows/migrations.yml`, in the `Probe the two Management API endpoints
link calls` step (:669-717):

- Rename the step to `Probe the Management API endpoints link calls`, since it is no
  longer two.
- Add a third `probe` call after `keys_status`:
  `reveal_status="$(probe "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true")"`
  and echo it as `GET /v1/projects/<ref>/api-keys?reveal=true -> $reveal_status`.
- IMPORTANT: the existing `probe()` helper already uses
  `curl -s -o /dev/null -w '%{http_code}'`, which is what keeps the body out of the log.
  Reuse it verbatim. `?reveal=true` returns the project's live anon and service-role key
  **values**, so the `-o /dev/null` is more load-bearing here than on the plain
  `/api-keys` call. Do not add `-v`, do not capture the body into a variable, and do not
  add a fallback that echoes the response on a non-200.
- Extend the comment above `probe()` to say why the reveal arm exists: `link` caches key
  values, so revealing them is the privileged operation where listing them is not, and
  this arm is the one that separates "link's key fetch is gated" from "link calls some
  fourth endpoint entirely".
- Update the interpretation guide's `200 then 200` branch (:710-717). Replace its "narrow
  it by probing /api-keys?reveal=true" prose, now that the arm exists, with the readings
  of the third code:
  - `reveal 403` - hypothesis confirmed in its privileged form. Remediation B: take the
    Management API off the critical path (the guide already spells the secret's shape out
    in the `200 then 403` branch; cross-reference it rather than repeating it).
  - `reveal 200` - all three endpoints answer this token and `link` still fails, so the
    403 comes from a call none of these probes replicate. Do not remediate on a guess;
    compare against the 2.117.0 dispatch and report both to
    https://github.com/supabase/cli/issues/6392.
  - `reveal 401` - remediation A, mint a replacement PAT.

### Step 2: Dispatch `diagnose` from this branch and from a 2.117.0 throwaway branch

- Commit step 1 to `chore/issue-89-adw-3874a012-require-prod-migration-sync`, push, then:
  `gh workflow run migrations.yml --ref chore/issue-89-adw-3874a012-require-prod-migration-sync -f job=diagnose`,
  then `gh run watch <run-id>`. Record the run id and all three status codes.
- Create a throwaway branch off this one, change **all four** `version: 2.116.0` pins
  (`dry-run` :285, `push` :320, `drift-check` :361, `prod-migration-sync` :490, `diagnose`
  :651 - bump every one, the header requires they never drift apart), push it, and
  dispatch `diagnose` against it the same way. The header at :190-198 already records
  that dispatching an arm the default branch has never heard of works, so no merge is
  needed.
- Read the second run's `supabase --version` output to confirm the pin actually resolved
  to 2.117.0 before comparing anything; `supabase/setup-cli` does not log what it
  installed, which is the whole reason that step exists.
- Delete the throwaway branch once both runs are read. Do **not** merge the pin bump into
  this chore branch unless 2.117.0 is what fixes the link.

### Step 3: Write both results into the header and report upstream

- In the header block, after the existing verdict paragraph (:112-131) and in place of
  the "The probe that narrows it" paragraph (:147-151) now that both probes have run,
  write what was observed: the reveal probe's status code with its run id, and the
  2.117.0 run's three status codes and link outcome with its run id. Keep the file's
  house style: prose that explains the reasoning, not bullets. State plainly which
  hypothesis each result kills.
- Post the same two results as a comment on https://github.com/supabase/cli/issues/6392,
  which already reproduces this message on 2.116.0 and 2.107.0. Include the status codes
  and the CLI versions; include no token, no project ref, and no key material.

### Step 4: Apply remediation B if the reveal probe returned 403

Only if step 2 observed `403` on `?reveal=true`. If it returned `200`, stop at step 3,
record that the cause is still outside the probed surface, and report that the link
repair remains blocked on upstream rather than editing the connect mechanism on a guess.
If it returned `401`, hand remediation A (mint a replacement PAT, update
`SUPABASE_ACCESS_TOKEN`) to the operator and re-dispatch `diagnose` instead.

On a 403:

- State the operator prerequisite explicitly in the patch's completion report and in the
  header: a `SUPABASE_DB_URL` repo secret holding a **session-pooler** connection string,
  `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
  Two gotchas that each cost a debugging round otherwise: GitHub-hosted runners are
  IPv4-only and the direct `db.<ref>.supabase.co` host is IPv6-only, so the pooler host is
  the one that resolves; and session mode (5432) not transaction mode (6543), because
  migrations need session-level statements. The password must be percent-encoded.
- Delete the `Link to prod project` step from `push` (:322-323), `drift-check` (:363-364)
  and `prod-migration-sync` (:499-504). Preserve `prod-migration-sync`'s comment about the
  connect step being load-bearing by moving its substance onto the `--db-url` call: the
  reason it must not be wrapped in `continue-on-error` is unchanged by the mechanism.
- Replace `--linked` with `--db-url "$SUPABASE_DB_URL"` on every call: `supabase db push`
  (:326), `supabase db push --dry-run` (:401), `supabase migration list --linked` (:415),
  and `supabase migration list --linked --output-format json` (:541). Add
  `SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}` to each of the three jobs' `env:`
  blocks.
- Keep `SUPABASE_ACCESS_TOKEN` in a job's env only where something still uses it. If
  nothing in a job does, remove it from that job and say so in the header.
- Update the header's Secrets paragraph (:68-70) to name `SUPABASE_DB_URL` and to state
  why `link` was abandoned: not because the 403 was mysterious, but because a gate that
  an upstream privilege change can break is not a gate.
- Leave `diagnose` on `link` untouched. It is the probe for exactly this failure and must
  keep reproducing it.

### Step 5: Dispatch `drift-check` and confirm green

- `gh workflow run migrations.yml --ref chore/issue-89-adw-3874a012-require-prod-migration-sync -f job=drift-check`,
  then `gh run watch <run-id>`. Note that `drift-check` pins `ref: master` on its
  checkout, so it compares prod against `master` regardless of which branch dispatched
  it, which is what makes this a valid test of the spec's "green against current master"
  criterion from the chore branch.
- Expected green: `master`'s newest migration is `20260828120000_grant_service_role_all_public.sql`
  and prod holds it.
- If the run is still blocked on the operator secret, report the patch as complete on the
  branch with this one validation step open and named. Do not report it as passing.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config so the commit hook will
  not reject it. This is also the YAML syntax check: Prettier parses
  `.github/workflows/migrations.yml`, so a malformed workflow fails here, not on a runner.
- `yarn knip` - No unused files, exports or dependencies introduced.
- `yarn turbo run lint --filter=./apps/website` - Lint still passes.
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound.
- `yarn turbo run test --filter=./apps/website` - Unit tests pass, proving zero regressions.
- `yarn turbo run build --filter=./apps/website` - Production build succeeds.
- `gh run list --workflow=migrations.yml --event=workflow_dispatch --limit=10` - Shows the
  new `diagnose` run from this branch, the `diagnose` run from the 2.117.0 throwaway
  branch, and the `drift-check` run. Three or more `workflow_dispatch` rows, not one.
- `gh run view <diagnose-run-id> --log | grep -E 'api-keys|projects/'` - The three status
  codes are present and no key material, token, or response body appears anywhere in the
  log.
- `gh workflow run migrations.yml --ref chore/issue-89-adw-3874a012-require-prod-migration-sync -f job=drift-check`
  then `gh run watch <run-id>` - Drift-check connects and reports no drift against
  `master`. Green here is the precondition for finding 1 and for spec step 7. If it is
  blocked on the operator-created `SUPABASE_DB_URL` secret, report it open.

## Patch Scope

**Lines of code to change:** ~15 for steps 1-3 (one new probe call, an updated
interpretation branch, two header paragraphs). ~40 more if step 4's remediation B
applies: three deleted `Link to prod project` steps, four `--linked` to `--db-url`
swaps, three `env:` additions, one rewritten Secrets paragraph.

**Risk level:** medium. The YAML edits are small and prettier-checked, and `diagnose` is
read-only. The risk sits in remediation B, which changes how three prod-touching jobs
connect, and in the secret handling: `?reveal=true` returns live anon and service-role
keys, so any change to the `probe()` helper that lets a body reach the log leaks
production credentials into a run log that cannot be un-published. The ruleset is
untouched, so `master` cannot be locked by this patch.

**Testing required:** The dispatched runs are the test, as the spec's Test Coverage
section argues. The `diagnose` runs prove the probe arm works and leaks nothing; the
dispatched `drift-check` proves the connect path works end to end against prod. The six
local commands above prove no regression elsewhere in the repo.
