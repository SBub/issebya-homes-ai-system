# Chore: make prod migration sync a required check for merges to master

## Metadata

issue_number: `89`
adw_id: `3874a012`
issue_json: `{"number":89,"title":"ci(migrations): supabase link 403 leaves committed migrations unapplied; make prod migration sync a required check for merges to master"}`

## Chore Description

`.github/workflows/migrations.yml` applies `supabase/migrations/**` to the hosted prod
project only in its `push` job, which fires after a merge to `master`. That job has
failed at `supabase link` since 2026-09-10 with a 403:

```
Authorization failed for the access token and project ref pair: {"message":"Your account
does not have the necessary privileges to access this endpoint. ..."}
```

Because the apply happens after the merge, a failure blocks nothing. Migrations land in
git and never reach prod, and the next promotion merges on top regardless. The
`protect-master` ruleset (id `22536056`) currently requires only `check` (ci.yml) and
`eval-gate` (eval-golden.yml), so no migration job gates anything.

The consequence is already on the ground. `supabase/migrations/20260921092000_grant_anon_select_documents.sql`
(the fix for the GCA knowledge-base `42501` failure running since 2026-08-04) could not
be delivered by the pipeline, so its GRANTs were run by hand in the Supabase SQL editor
on 2026-09-21. Prod holds the privilege but has no `schema_migrations` row for it: the
exact drift the workflow header warns about.

This chore does four things:

1. **Diagnose** the 403 from inside CI, where the credentials actually live, by adding a
   read-only `diagnose` arm to the existing `workflow_dispatch`.
2. **Fix** the link, either by replacing the access token (cheap, no new secret) or, if
   the Management API privilege check is genuinely the cause, by taking the Management
   API off the critical path entirely with a direct `--db-url` connection.
3. **Gate** merges into `master` with a new `prod-migration-sync` job, and make both it
   and the existing `drift-check` required status checks on the `protect-master` ruleset.
4. **Correct** the workflow header, which currently overstates the evidence: it says
   "every push run has failed" when exactly one push run has failed, and it presents the
   2.116.0 CLI pin as "the experiment for this specific failure" when zero
   `workflow_dispatch` runs exist, so that experiment has never been run.

### Facts established while planning (do not re-derive)

- `origin/master`'s `.github/workflows/migrations.yml` is still the original `d266b7e`
  version. The CLI pin (`0afbf3c`) and `drift-check` (`8b07d52`) exist on `develop` only.
  Everything this plan edits is therefore edited on the `develop` side and reaches
  `master` through the promotion PR.
- `origin/master`'s newest migration is `20260828120000_grant_service_role_all_public.sql`.
  `20260921092000_grant_anon_select_documents.sql` is on `develop` only.
- That migration is three plain `grant` statements. `GRANT` is idempotent, so
  re-applying it through `supabase db push` after the hand-run is safe and is what
  finally writes the `schema_migrations` row.
- The ruleset is readable with the current `gh` login (scopes `repo`, `workflow`,
  `read:org`). `bypass_actors` is empty and `current_user_can_bypass` is `never`, so a
  required check that can never go green blocks every merge into `master` with no admin
  override. **This is why the link must be fixed before the ruleset is changed.**
- `supabase migration list --linked --output-format json` works on the pinned CLI
  2.116.0. Verified locally against the shared local database with
  `yarn supabase migration list --local --output-format json`, which emits
  `{"migrations":[{"local":"20260718123130","remote":"20260718123130","time":"..."}],"message":"Migrations listed"}`
  on stdout, with the "Connecting to..." chatter on stderr. This removes the need for
  the brittle pipe-column `awk` parsing the current `drift-check` uses and which its own
  header flags as the first thing to suspect if the job ever disagrees with reality.
- `supabase db push` and `supabase migration list` both accept `--db-url` on 2.116.0
  (confirmed from `--help`). `--db-url` needs no `supabase link` and no Management API
  call, which is what makes remediation B below a genuine fix rather than a retry.
- `jq` is preinstalled on `ubuntu-latest` runners.
- Prettier formats and therefore syntax-checks `.github/workflows/*.yml`; the file is
  currently clean under `yarn prettier --check`.

## Relevant Files

Use these files to resolve the chore:

- `.github/workflows/migrations.yml` - the whole of the workflow change. Header
  correction, the new `diagnose` dispatch arm, the new `prod-migration-sync` job, and
  the `link` to `--db-url` swap if remediation B is needed. Read the entire header block
  before editing: it is a reasoned record, not decoration, and the corrections below are
  amendments to specific claims in it rather than a rewrite.
- `.github/workflows/eval-golden.yml` - read only, for precedent. It documents how a
  required check on `master` is expected to behave, and it is the cautionary example for
  `paths:` filters on required checks (see Notes).
- `.github/workflows/ci.yml` - read only. Supplies the other required context name
  (`check`) that must be preserved verbatim in the ruleset PUT.
- `supabase/migrations/20260921092000_grant_anon_select_documents.sql` - the migration
  whose delivery is the acceptance test for the whole repair.
- `apps/website/app_docs/database/production-migrations.md` - currently describes only
  the manual `yarn supabase:push` route and does not mention that CI owns the prod apply,
  that `master` is the only branch whose migrations may reach prod, or that hand-running
  SQL in the dashboard creates drift the pipeline will flag. Needs a CI section.
- `docs/conditional-docs.md` - the index. The `production-migrations.md` entry needs its
  conditions widened to cover the CI path and the required checks.
- `AGENTS.md` - repo conventions the change must respect (yarn only, conventional
  commits, no `Co-Authored-By`, lefthook gates).

### New Files

None. Every change is an edit to an existing file plus one GitHub API call against the
ruleset.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Correct the factual claims in the workflow header

Edit the comment block at the top of `.github/workflows/migrations.yml`. Three claims
are wrong or overstated and the issue's acceptance criteria call them out explicitly.

- In the "Secrets" paragraph, replace "Since 2026-09-10 every push run has failed at
  `supabase link`" with the actual, much narrower evidence: **one** push run has failed,
  run `34486392180` on 2026-09-10 14:02Z, the merge of #46. Name the last green run too
  (`33164166436`, 2026-08-28 10:39Z, applied `20260828120000_grant_service_role_all_public.sql`).
  The point matters: "every run fails" implies a reproduced, repeated fault, and what
  actually exists is a single sample.
- In the "CLI version" paragraph, remove the claim that the pin "is the experiment for
  this specific failure". Zero `workflow_dispatch` runs exist on this workflow, so the
  experiment was never run. Record that, and record why the hypothesis is now weak
  rather than untested: upstream https://github.com/supabase/cli/issues/6392 reproduces
  the identical message on 2.116.0, so a version pin alone is unlikely to fix it. Demote
  the pin to what it still legitimately does, which is make runs reproducible and keep
  `latest` from being an unpinned external input.
- Add a short paragraph naming the leading hypothesis and how it gets tested: a
  Management API privilege change on `GET /v1/projects/{ref}/api-keys`, the call `link`
  makes after `GET /v1/projects/{ref}`, probed by the new `diagnose` job in step 2.

Keep the existing house style of the file: prose comments that explain the reasoning,
not bullet-point summaries.

### 2. Add a read-only `diagnose` arm to `workflow_dispatch`

The root cause cannot be identified from a developer machine: `SUPABASE_ACCESS_TOKEN` is
a repo secret and must not be extracted. Put the probe where the credential already is.

- Add `diagnose` to the `workflow_dispatch` `job` input's `options` list. Leave the
  default as `drift-check`; writing to prod stays opt-in.
- Add a `diagnose` job gated on
  `github.event_name == 'workflow_dispatch' && inputs.job == 'diagnose'`.
- Do **not** pin `ref: master` on its checkout, unlike `push` and `drift-check`. Those
  two pin `master` because they act on migration history and prod is deployed from
  `master`. `diagnose` asks a question about credentials, not about history, and should
  answer it for whatever branch the operator dispatched. Add a comment saying so, since
  every other checkout in this file is pinned and an unexplained exception reads as an
  oversight.
- Steps, in this order, each one narrowing the hypothesis space:
  1. `supabase --version`. `supabase/setup-cli` does not log what it installed, which is
     precisely why the 2.116.0-versus-2.117.0 story is inferred from release dates rather
     than observed. This ends that.
  2. `supabase projects list`. If this succeeds and shows `gqoeyqvwgmkyxasqknss`, the
     token is alive, the account can see the project, and hypothesis 4 (project ref
     mismatch) is dead.
  3. Two `curl` probes against the Management API, printing **only the HTTP status code**:
     - `GET https://api.supabase.com/v1/projects/$REF`
     - `GET https://api.supabase.com/v1/projects/$REF/api-keys`

     IMPORTANT: never echo the response body of the `api-keys` probe. On success it
     returns the project's live anon and service-role keys. Use
     `curl -s -o /dev/null -w '%{http_code}'`. The repo already runs
     `eslint-plugin-no-secrets` over source; do not undo that discipline in CI logs.
     Pass the token with `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"` and never
     interpolate it into a logged string.

  4. `supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}` last, so the
     probes above are already in the log when it fails.
- Print a short interpretation guide in the job's own output (a `::notice::` or an
  `echo` block) so whoever reads the run does not have to reconstruct it:
  - `200` on `/projects/$REF` and `403` on `/api-keys` confirms hypothesis 1, the
    Management API privilege change. Go to remediation B in step 4.
  - `401` on either probe means the token is dead or malformed despite the dashboard
    saying otherwise. Go to remediation A.
  - `403` on both probes means the account lacks project access outright, which
    contradicts `projects list` succeeding; re-check which org the token belongs to.
  - Both probes `200` but `link` still fails means the fault is CLI-side, hypothesis 3.
    Bump the pin to 2.117.0 on a throwaway branch and dispatch `diagnose` again to
    compare, and add the finding to upstream issue 6392.

### 3. Run the probe and record the root cause

- Commit and push steps 1 and 2 to this chore branch, then merge to `develop` (or
  dispatch directly from the chore branch: `workflow_dispatch` can target any branch).
- `gh workflow run migrations.yml --ref <branch> -f job=diagnose`, then
  `gh run watch` on the resulting run id.
- `gh workflow run migrations.yml --ref <branch> -f job=drift-check`, then `gh run watch`.
  This is the "dispatched drift-check run" the acceptance criteria name. Expected today:
  it fails at the link step, identically to the push job, which is itself a datum (it
  proves the failure is in `link` and not in anything `db push` does afterwards).
- Write the verdict into the workflow header, replacing the "The cause is still
  unresolved" sentence with what the probe actually showed, including the run id. This
  file is the project's record of this incident and the next person to read it should not
  have to re-run anything.

### 4. Apply the remediation the probe indicates

Two branches. Attempt A first only if the probe points at the token; go straight to B if
the probe confirms the `api-keys` 403.

**Remediation A, token replacement (no workflow change).** If the probe shows `401`, or
shows that the PAT is scope-limited, mint a replacement personal access token on an
account that owns the `issebya` org, with full scope rather than a scoped token, and
update the `SUPABASE_ACCESS_TOKEN` repo secret (`gh secret set SUPABASE_ACCESS_TOKEN`).
Re-dispatch `job=diagnose`. If it goes green, the chore's workflow surface is unchanged
and you proceed to step 5. If it still 403s on `/api-keys`, A has been falsified: do B.

**Remediation B, take the Management API off the critical path.** This is the fix that
makes the gate dependable, and it is the recommended end state regardless of what A does,
because `link` will remain a dependency on a third-party API's privilege model that this
repo cannot influence. A required check must not be able to fail for reasons unrelated to
the thing it checks.

- Add a `SUPABASE_DB_URL` repo secret holding a **session-pooler** connection string:
  `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
  Two gotchas, both of which will otherwise cost a debugging round:
  - GitHub-hosted runners are IPv4-only and the direct `db.<ref>.supabase.co` host is
    IPv6-only on current projects. The pooler host is the one that resolves. Use session
    mode (port 5432), not transaction mode (6543): migrations need session-level
    statements.
  - The CLI's `--help` states the connection string must be percent-encoded. Percent-encode
    the password before storing the secret.
- In `push`, `drift-check`, and the new `prod-migration-sync`, delete the
  `Link to prod project` step and replace `--linked` with `--db-url "$SUPABASE_DB_URL"`
  on every `supabase db push` and `supabase migration list` invocation. Keep
  `SUPABASE_ACCESS_TOKEN` in the job env only if something still needs it; if nothing
  does, remove it and say so in the header.
- Update the header's "Secrets" paragraph to describe the new secret and, importantly,
  why the workflow stopped using `link`: not because the 403 was mysterious, but because
  a gate that can be broken by an upstream privilege change is not a gate.

Whichever branch you take, re-dispatch `job=drift-check` and confirm it goes green
against current `master` (which is in sync: `master`'s newest migration `20260828120000`
is applied in prod). A green drift-check is the precondition for step 6.

### 5. Add the `prod-migration-sync` job

New job in `.github/workflows/migrations.yml`.

- Gate: `github.event_name == 'pull_request' && github.base_ref == 'master'`.
- IMPORTANT: no `paths:` filter on the trigger, and **no `if` gate on the `changes` job's
  output**. Both are traps for a required check, in opposite directions, and both must be
  commented in the job so nobody "optimises" them back in later:
  - A job skipped by an `if` reports a `skipped` conclusion, which GitHub counts as
    satisfying a required check. Gating this job on `changes` would make it pass by
    disappearing on exactly the PRs where nothing forced it to run.
  - A workflow suppressed by a `paths:` filter never reports its check at all, which
    leaves a required context pending forever and blocks the merge outright.
- Checkout with `fetch-depth: 0` and do **not** pin `ref`. This is the one job that wants
  the PR's merge commit: it is asking about the state after this PR lands, which is
  precisely the question `drift-check` deliberately refuses to ask (see its comment about
  not crying wolf on the PR's own contents). Comment the contrast explicitly, because
  `ref: master` on the two neighbouring jobs is load-bearing and someone will otherwise
  assume this one is a mistake.
- `supabase/setup-cli@v1` with the same pinned `version:` the other jobs use. If step 4
  bumped the pin, bump it here to match; the three must never drift apart.
- Connect per step 4's outcome: either `supabase link --project-ref ...` then `--linked`,
  or `--db-url "$SUPABASE_DB_URL"`. **The job must fail if the connection fails.** Do not
  wrap the connect step in `continue-on-error`. This is the single most load-bearing line
  in the chore: it is what makes a broken delivery pipeline block the next promotion
  instead of being discovered months later.
- Compute three sets and compare them. Use `--output-format json` and `jq`, not column
  parsing:
  - `remote`: versions applied in prod.
    `supabase migration list --linked --output-format json` (stdout only; the connection
    chatter goes to stderr), then
    `jq -r '.migrations[] | select((.remote // "") != "") | .remote'`. The `// ""` guard
    is deliberate: the local run verified the shape for rows present on both sides, but
    how a remote-absent row encodes its `remote` field (empty string, `null`, or key
    omitted) was not observed. The guard handles all three.
  - `master_local`: versions on `master`,
    `git ls-tree --name-only origin/master supabase/migrations/` reduced to the leading
    timestamp of each filename.
  - `pr_local`: versions in the checked-out tree, the same reduction over
    `supabase/migrations/`.
- Assertions:
  1. `master_local - remote` must be empty. Non-empty means a migration that is already
     on `master` was never applied to prod: a failed or skipped push. **Fail**, listing
     the versions and pointing at `Run workflow` with `job=push` as the remedy.
  2. `remote - pr_local` must be empty. Non-empty means prod holds a version with no file
     in this PR's tree: history repaired outside the repo, or a migration file deleted by
     this PR. **Fail**, listing the versions.
  3. `pr_local - master_local` is informational: exactly the migrations this PR will hand
     to the `push` job after it merges. Print it as a summary so the reviewer sees what
     the merge is about to do to prod. Do not fail on it. Failing here would red every
     migration promotion PR, which is the specific cry-wolf failure `drift-check`'s
     header already argues against.
- Guard the parsing itself the way `drift-check` does. If the `jq` extraction yields an
  empty `remote` set while `master_local` is non-empty, that is far more likely to be a
  changed output shape than a wiped prod history: fail with an explicit "could not
  determine remote migration state" error rather than reporting hundreds of phantom
  missing migrations.
- Set `set -uo pipefail` and turn errexit off (`set +e`) in the comparison step, matching
  `drift-check`: both CLI calls exit 0 regardless of content and their output has to be
  inspected by hand.

### 6. Promote to master and deliver the stranded migration

Only after step 4 produced a green dispatched `drift-check`.

- Land steps 1 to 5 on `develop` through the normal PR flow.
- Open the `develop` to `master` promotion PR. On it, confirm the three checks report:
  `check`, `eval-gate`, and now `drift-check` plus `prod-migration-sync`.
  - `drift-check` compares `master` (pre-merge) against prod: green, because `master`
    stops at `20260828120000` and prod has it.
  - `prod-migration-sync` compares the merge commit against prod: assertion 1 is empty
    (`20260921092000` is new in this PR, not on `master`), assertion 2 is empty (prod's
    history stops at `20260828120000` because the 2026-09-21 grants were hand-run without
    a `schema_migrations` row), and the informational line reports
    `20260921092000` as the one migration the merge will apply. Green.
- Merge. The `push` job fires (the PR touches `supabase/migrations/**`) and applies
  `20260921092000`. The three `grant` statements re-run harmlessly over the hand-applied
  state and the `schema_migrations` row is finally written.
- Verify with `gh run watch` on the push run, and then by dispatching `job=drift-check`
  once more: it must report no drift, which is the same thing as saying prod now records
  `20260921092000`.

### 7. Make both jobs required on the `protect-master` ruleset

Only after step 6 shows both jobs green on a real PR. Requiring a check that has never
reported green, on a ruleset with no bypass actors, locks `master` for everyone.

- Read the current state first:
  `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056`.
- PUT the ruleset back with `required_status_checks` extended from
  `[{"context":"check"},{"context":"eval-gate"}]` to
  `[{"context":"check"},{"context":"eval-gate"},{"context":"drift-check"},{"context":"prod-migration-sync"}]`.
  Preserve every other rule and parameter verbatim, including the `deletion`,
  `non_fast_forward` and `pull_request` rules, `strict_required_status_checks_policy:
false`, and `do_not_enforce_on_create: false`. The safe shape is to fetch the JSON,
  edit only the one array (with `jq`), and PUT the result, rather than hand-writing a new
  body.
- Re-read the ruleset afterwards and confirm all four contexts are present:
  `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`.
- The context names must match the **job ids** (`drift-check`, `prod-migration-sync`)
  exactly, since neither job sets a `name:`. A typo here produces a context that never
  reports and blocks `master` permanently.

### 8. Prove the gate actually blocks

The acceptance criterion is behavioural ("a PR into master with an unapplied local
migration or a failing link cannot merge"), so assert it rather than assuming it.

- On a throwaway branch off `master`, open a draft PR into `master` that deletes
  `supabase/migrations/20260828120000_grant_service_role_all_public.sql` (a version prod
  holds). `prod-migration-sync` assertion 2 must fail and the PR's merge button must be
  blocked. Close the PR without merging and delete the branch.
- Record the run id of that deliberate failure in the workflow header next to the
  assertions it exercised. A gate nobody has seen fail is a gate nobody knows works.

### 9. Update the documentation

- `apps/website/app_docs/database/production-migrations.md`: add a section covering the
  CI path. What it must say: the prod apply is owned by `.github/workflows/migrations.yml`
  and happens on merge to `master`, `master` is the only branch whose migrations may
  reach prod, `prod-migration-sync` and `drift-check` are required checks so a broken
  delivery pipeline now blocks the next promotion, and running SQL by hand in the
  dashboard creates drift that `prod-migration-sync` assertion 2 will surface on the next
  promotion PR. Keep the existing manual section; it is still the local and emergency
  route, but it should now be framed as the exception.
- `docs/conditional-docs.md`: widen the `production-migrations.md` entry's conditions
  beyond "When a schema change has to reach production" to also cover changing
  `.github/workflows/migrations.yml`, adding or changing a required status check on
  `master`, and diagnosing a failed prod migration apply.
- Do not add any of this to `AGENTS.md`. Per the repo's own convention, `AGENTS.md` holds
  behavioural rules only, and reference material belongs in `README.md` or the app docs.

### 10. Run the validation commands

Run every command in the `Validation Commands` section and confirm each exits clean.

## Test Coverage

**No automated test needed, and adding one would be worse than not.** The change is a
GitHub Actions workflow plus a repository ruleset setting plus two markdown files. The
three test layers this repo has (`*.unit.test.ts` under the node pool,
`*.browser.test.tsx` under Vitest browser mode, and Playwright specs in
`apps/website/e2e/`) all live inside `apps/website` and exercise application code. None
of them can execute a workflow YAML, authenticate to the Supabase Management API, or read
a branch ruleset. There is no root-level test runner to extend, and creating one to
host a test for shell that only ever runs on a GitHub runner would be inventing a fourth
layer for a single file.

The shell comparison logic in step 5 is the one part with real behaviour worth proving,
and this plan proves it the only way that is actually meaningful: step 8 opens a PR that
deliberately violates assertion 2 and confirms the merge is blocked, and step 6 confirms
the green path on a PR that carries a real pending migration. Those two runs are the test.
Step 3's dispatched `diagnose` and `drift-check` runs cover the connection path.

No `apps/website` UI flow changes, so no Playwright spec and no agent-driven `e2e/*.md`
journey is warranted either.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config so the commit hook will
  not reject it. This is also the YAML syntax check: Prettier parses
  `.github/workflows/migrations.yml`, so a malformed workflow fails here rather than on a
  runner.
- `yarn knip` - No unused files, exports or dependencies were introduced.
- `yarn turbo run lint --filter=./apps/website` - Lint still passes for the one workspace
  whose docs directory this chore touches.
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound; proves the
  markdown and workflow edits introduced no incidental TypeScript breakage.
- `yarn turbo run test --filter=./apps/website` - Unit tests pass, proving zero
  regressions.
- `yarn turbo run build --filter=./apps/website` - Production build succeeds.
- `gh workflow run migrations.yml --ref develop -f job=diagnose` then
  `gh run watch <run-id>` - The probe job runs and prints the CLI version, the project
  list, and the two HTTP status codes, with no secret material in the log.
- `gh workflow run migrations.yml --ref develop -f job=drift-check` then
  `gh run watch <run-id>` - Drift-check connects and reports no drift against `master`.
  This must be green before step 7.
- `gh run list --workflow=migrations.yml --branch=master --limit=5` - The post-merge
  `push` run is green and applied `20260921092000`.
- `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`
  - Returns all four contexts: `check`, `eval-gate`, `drift-check`,
    `prod-migration-sync`.
- `gh pr checks <promotion-pr-number>` - All four required checks report on a real PR
  into `master`, none of them as `skipped`.

## Notes

- **`prod-migration-sync` and `drift-check` overlap, deliberately.** Both connect to prod
  and both compare migration history, so roughly the same failure trips both. They differ
  in what they check out: `drift-check` pins `ref: master` and asks "does prod match
  `master` as it stands now, before this PR", while `prod-migration-sync` uses the merge
  commit and asks "after this PR lands, is the only thing prod is missing exactly what
  this PR adds". The second catches things the first cannot, such as a PR that deletes a
  migration file prod already holds, or a PR branched from stale `master`. The issue's
  acceptance criteria name both as required checks, so both are kept. If the redundancy
  becomes a maintenance cost later, the clean consolidation is to fold `drift-check`'s
  assertions into `prod-migration-sync` and demote `drift-check` to the dispatch-only
  probe it already has an arm for. Do not do that as part of this chore.
- **`eval-gate` is a required check behind a `paths:` filter**, which is the failure mode
  step 5 forbids for `prod-migration-sync`: on a PR into `master` that touches no
  `apps/guest-communication-agent/**` file, `eval-golden.yml` does not run and the
  `eval-gate` context never reports. In practice promotion PRs have carried GCA changes,
  so this has not bitten yet. It is out of scope here (fixing it means either dropping the
  filter or adding a skip-reporting shim job) but it is worth its own issue, and it should
  not be copied.
- **Ordering is the risk in this chore, not the YAML.** The ruleset change in step 7 is
  the point of no return: with `bypass_actors: []` and `current_user_can_bypass: "never"`,
  a required check that cannot go green locks `master` with no admin override. Steps 3,
  4 and 6 exist to make that safe, and step 7 must not be pulled forward.
- **Do not run `supabase start`, `supabase db reset`, or any local database reset.** The
  repository runs a single shared local instance. The only local Supabase command this
  chore needs is the read-only `yarn supabase migration list --local --output-format json`,
  already run during planning to confirm the JSON shape.
- The `dry-run` job is untouched. It spins up an ephemeral local Postgres inside the
  runner via `supabase start`, which is entirely separate from the developer's shared
  local instance and needs no change here.
- Commit messages follow the repo's conventional-commit rule with no `Co-Authored-By`
  trailer. The `ci(migrations):` scope matches the four commits already in this file's
  history.
- Upstream reference for the 403, to cite in the header: https://github.com/supabase/cli/issues/6392.
  It is open, reproduces on 2.107.0 and 2.116.0, and carries a 2026-09-10 comment
  reporting a same-day break in GitHub Actions. The access-control doc that Supabase's own
  error message links to never mentions `link` or this message, so it is not a useful
  source.
- Optional item (d) from the issue, a daily `migration list --linked` alert to Telegram
  via the Cloudflare Worker cron, is deliberately **not** in this plan. The workflow
  header already argues at length against a daily cadence for a signal that can only
  change when a migration merges, and once `prod-migration-sync` is a required check the
  failure is caught at the gate instead of hours later. Revisit only if drift is ever
  observed arriving by a route other than a merge.
