# Patch: hand off the blocked prod-migration gate to a Supabase org owner

## Metadata

adw_id: `3874a012`
review_change_request: `Issue #1: Spec steps 4 (the SUPABASE_DB_URL secret), 6 (promote to master and deliver the stranded migration), 7 (extend the protect-master ruleset) and 8 (prove the gate blocks) were not executed, so the chore ships an inert gate. Verified live at HEAD cb6fcc5: the protect-master ruleset requires only check and eval-gate; gh secret list shows no SUPABASE_DB_URL; dispatched drift-check run 35607215583 fails at the new Require SUPABASE_DB_URL step; master's newest migrations.yml run is still 34486392180 (2026-09-10, failure) so 20260921092000_grant_anon_select_documents.sql is still stranded; no develop-to-master promotion PR exists; step 8's deliberate-failure PR was never opened. Three of issue #89's five acceptance criteria are consequently false. The job's shell has never executed on a runner (its if gates on github.base_ref == 'master'), though the comparison logic was replayed by hand against the real origin/master and HEAD trees and behaves as specified. Resolution: no patch to this branch can resolve this; every remaining step is blocked behind a repo secret that requires the prod Supabase database password, which only a Supabase org owner can read, so this needs a human handoff rather than another patch-and-resolve iteration. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`

**Issue:** Spec steps 4, 6, 7 and 8 are unexecuted and cannot be executed from this
branch. All four sit behind one missing repo secret, `SUPABASE_DB_URL`, whose value is
the prod Supabase database password. Only a Supabase org owner can read that password,
so no agent and no commit on this branch can produce it. Everything downstream is
therefore stalled: the promotion PR would go red on three checks, the ruleset must not
be extended with a check that cannot go green (`bypass_actors: []`,
`current_user_can_bypass: "never"` would lock `master` for everyone), and the
deliberate-failure proof in step 8 depends on the ruleset. Three of issue #89's five
acceptance criteria are false today and stay false until a human acts.

**Solution:** The review request's own resolution is "human handoff rather than another
patch-and-resolve iteration", and this patch does exactly that and nothing more. It does
not attempt any blocked step. It turns the handoff into a durable artifact so the
sequence survives this branch, this worktree and this ADW run:

1. A runbook at `docs/prod-migration-gate-handoff-sop.md` holding the six-step
   unblocking sequence in order, with the gotchas that each cost a debugging round, and
   the explicit warning that step 7 must not be pulled forward.
2. Three factual amendments to `.github/workflows/migrations.yml`'s header: the
   post-guard evidence run id, which acceptance criteria are still false, and the honest
   status of the gate's logic (replayed by hand, never executed on a runner).
3. One correction in `apps/website/app_docs/database/production-migrations.md`, which
   currently says the two jobs "are intended to be required status checks" without
   saying they are not, and without pointing anywhere.
4. A handoff comment on issue #89 so the blocker is visible where the work is tracked
   rather than only inside a workflow comment.

**What this patch deliberately does not do.** It does not create the secret, open the
promotion PR, PUT the ruleset, or open the deliberate-failure PR. Each is blocked on a
credential this branch cannot hold, and the ruleset PUT in particular is destructive if
pulled forward: requiring `drift-check` and `prod-migration-sync` while
`SUPABASE_DB_URL` is unset makes both fail closed at the `Require SUPABASE_DB_URL` step
on every PR, and with no bypass actor `master` becomes unmergeable by anyone. The
existing workflow YAML is left untouched apart from comments; the review request states
the comparison logic was replayed by hand against the real trees and behaves as
specified, so there is no defect to fix in it.

## Files to Modify

Use these files to implement the patch:

- `docs/prod-migration-gate-handoff-sop.md`: **new.** The runbook. Repo convention puts
  human procedures in `docs/*-sop.md` (see `docs/twilio-whatsapp-sender-sop.md` for the
  house style: terse, ordered, gotchas inline, written to be followed not read).
- `.github/workflows/migrations.yml`: comments only. The "Outstanding, and it needs a
  human" paragraph in the header block (around line 191), and the assertions comment
  inside the `prod-migration-sync` job.
- `apps/website/app_docs/database/production-migrations.md`: the "Why the gate exists"
  section's closing paragraph about required checks.

Explicitly **not** modified:

- `docs/conditional-docs.md`. Its own "How to use" section declares operational runbooks
  in `docs/*-sop.md` out of scope for the index. The new SOP is one, so it does not get
  an entry. The `production-migrations.md` entry there already covers the CI path and
  required-check conditions and needs no widening.
- `AGENTS.md`. Per repo convention it holds behavioural rules only.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Write `docs/prod-migration-gate-handoff-sop.md`

Follow `docs/twilio-whatsapp-sender-sop.md`'s style: a one-line statement of what the
document is for, a "What is blocked" section, then numbered steps that can be executed
without rereading the workflow header.

- **Opening:** this is a handoff to a Supabase org owner for the `issebya` org. One
  secret is missing; every remaining step of issue #89 is behind it. Nothing in the repo
  can proceed without someone who can read the prod database password.
- **What is blocked (state it as fact, with the evidence):**
  - `SUPABASE_DB_URL` does not exist as a repo secret. `gh secret list` returns
    `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT_ID`, `OPENROUTER_API_KEY`,
    `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and nothing else.
  - Dispatched `drift-check` run `35607215583` (headSha `cb6fcc5`, 2026-09-21 13:41Z)
    fails at the `Require SUPABASE_DB_URL` step. That is the guard working as designed,
    and it is the spec's "green dispatched drift-check" precondition for step 7 unmet.
  - `20260921092000_grant_anon_select_documents.sql` is still stranded. The newest
    `migrations.yml` run on `master` is still `34486392180` (2026-09-10, failure). Prod
    holds the hand-run `GRANT`s with no `supabase_migrations.schema_migrations` row.
  - The `protect-master` ruleset (`22536056`) still requires only `check` and
    `eval-gate`.
  - Three of issue #89's five acceptance criteria are consequently false: push is not
    green on `master` with `20260921092000` recorded, the two jobs are not required
    checks, and a PR into `master` carrying an unapplied local migration can still
    merge.
- **The sequence, six numbered steps, in this order and no other:**
  1. Create the `SUPABASE_DB_URL` repo secret
     (`gh secret set SUPABASE_DB_URL`). Value shape:
     `postgresql://postgres.<project-ref>:<percent-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
     Two gotchas, each worth a debugging round: the **pooler** host, because the direct
     `db.<ref>.supabase.co` host is IPv6-only and GitHub-hosted runners are IPv4-only so
     it does not resolve at all; and **session mode on port 5432**, not transaction mode
     on 6543, because migrations issue session-level statements that transaction pooling
     refuses. Percent-encode the password before storing.
  2. `gh workflow run migrations.yml --ref <branch> -f job=drift-check`, then
     `gh run watch <run-id>`. Confirm green against current `master`. This is the gate
     on everything below: do not continue if it is red.
  3. Land this branch on `develop`, then open the `develop`-to-`master` promotion PR.
     On it confirm `check`, `eval-gate`, `drift-check` and `prod-migration-sync` all
     report, and that **none reports `skipped`** (`gh pr checks <pr>`). Expected:
     assertion 1 empty, assertion 2 empty, and the informational line naming
     `20260921092000` as the one migration the merge will apply.
  4. Merge. Watch the `push` run apply `20260921092000` (the three `GRANT`s re-run
     harmlessly over the hand-applied state and the `schema_migrations` row is finally
     written), then re-dispatch `job=drift-check` and confirm no drift.
  5. Only now extend the ruleset. Fetch
     `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056`, edit **only** the
     `required_status_checks` array with `jq` to add `{"context":"drift-check"}` and
     `{"context":"prod-migration-sync"}`, and PUT the whole body back so the `deletion`,
     `non_fast_forward` and `pull_request` rules,
     `strict_required_status_checks_policy: false` and `do_not_enforce_on_create: false`
     all survive. The contexts are the **job ids** verbatim; neither job sets a `name:`,
     and a typo produces a context that never reports and blocks `master` permanently.
     Re-read afterwards and confirm all four contexts are present.
  6. Prove the gate blocks. Throwaway branch off `master`, draft PR into `master`
     deleting `supabase/migrations/20260828120000_grant_service_role_all_public.sql` (a
     version prod holds). Assertion 2 must fail and the merge button must be blocked.
     Record that run id in the workflow header next to the assertion it exercised, then
     close the PR without merging and delete the branch.
- **Why the order is not negotiable.** Give step 5 its own callout: the ruleset has
  `bypass_actors: []` and `current_user_can_bypass: "never"`, so requiring a check that
  cannot go green locks `master` for everyone with no admin override. Steps 1 to 4 exist
  to make step 5 safe. Step 6 needs step 5, because "the merge button is blocked" is a
  property of the ruleset, not of the workflow.
- **Pointers:** the workflow header in `.github/workflows/migrations.yml` for the full
  incident record (the `link` 403, the three diagnose runs, why `--db-url` replaced
  `supabase link`), `apps/website/app_docs/database/production-migrations.md` for the
  lifecycle table, and the original spec
  `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md` for steps 4
  to 8 in full.
- No em-dashes in the prose; use commas, periods, parentheses or colons.

### Step 2: Amend the workflow header's "Outstanding" paragraph

In `.github/workflows/migrations.yml`, in the paragraph beginning
`# Outstanding, and it needs a human.` (around line 191), keep everything already there
and add, in the same prose style:

- The post-guard evidence run. The paragraph currently cites `35607046865`, which is the
  pre-guard run where `--db-url ""` silently fell back to the runner's own Postgres
  socket. Add run `35607215583` (headSha `cb6fcc5`, 2026-09-21 13:41Z): the same dispatch
  after the guard landed, now failing at `Require SUPABASE_DB_URL` as itself. That is the
  guard's own proof, and it is the "green dispatched drift-check" precondition on the
  record as unmet.
- Which acceptance criteria are still false, named: `push` green on `master` with
  `20260921092000` recorded, the two jobs required, and a PR into `master` with an
  unapplied local migration being unmergeable. A reader of this file should not have to
  open issue #89 to learn the chore shipped incomplete.
- A single line pointing at `docs/prod-migration-gate-handoff-sop.md` as the runbook for
  the whole sequence, so the condensed order sentence already in this paragraph has
  somewhere to expand to.

### Step 3: Record the gate's real verification status in the job

Inside the `prod-migration-sync` job, next to the comment block describing the three
assertions, add a short comment stating plainly:

- This job's shell has never executed on a runner. Its `if` gates on
  `github.base_ref == 'master'` and every run so far has been a PR into `develop`, so it
  reports `skipped`.
- The comparison logic was replayed by hand against the real `origin/master` and `HEAD`
  trees: assertions 1 and 2 came back empty, assertion 3 reported `20260921092000`, and
  deleting `20260828120000` from the tree correctly tripped assertion 2. So this is an
  unverified gate rather than a known-broken one.
- The deliberate-failure run id belongs here, and is absent because step 6 of
  `docs/prod-migration-gate-handoff-sop.md` has not been run. Whoever runs it writes the
  id here. The file's own standard stands: a gate nobody has seen fail is a gate nobody
  knows works.

Comments only. Do not change a single line of the job's YAML or shell.

### Step 4: Correct the required-checks claim in the app doc

In `apps/website/app_docs/database/production-migrations.md`, in the "Why the gate
exists" section, the paragraph beginning "Both `prod-migration-sync` and `drift-check`
are intended to be required status checks" understates the situation: a reader can come
away thinking the gate is live.

- State outright that as of 2026-09-21 neither is a required check yet, that the
  `protect-master` ruleset still requires only `check` and `eval-gate`, and that until
  that changes a broken delivery pipeline is still only a red X rather than a blocked
  merge button.
- Give the one-line reason (the `SUPABASE_DB_URL` secret does not exist; creating it
  needs the prod database password, which only a Supabase org owner can read) and link
  `docs/prod-migration-gate-handoff-sop.md`.
- Keep the existing sentences about `paths:` filters and `if` gates on `changes`
  verbatim. They are load-bearing warnings and are unaffected.

### Step 5: Hand the blocker off on the issue, and leave it open

- `gh issue comment 89` with a short comment: what shipped (the workflow jobs, the
  `--db-url` remediation, the fail-closed guard, the docs), what did not (spec steps 4,
  6, 7, 8), the one blocker (`SUPABASE_DB_URL`, needs a Supabase org owner), a link to
  `docs/prod-migration-gate-handoff-sop.md`, and the three acceptance criteria that stay
  false until someone runs it.
- Do **not** close issue #89, and do not mark the chore complete. Three acceptance
  criteria are unmet by the review's own live verification.
- Commit everything in one conventional commit, no `Co-Authored-By` trailer, for example
  `docs(migrations): hand off the blocked prod migration gate`.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn prettier --check .`: formatting matches the repo config so the commit hook will
  not reject it. This also parses `.github/workflows/migrations.yml`, so a comment edit
  that breaks the YAML fails here rather than on a runner.
- `yarn knip`: no unused files, exports or dependencies introduced.
- `yarn turbo run lint --filter=./apps/website`: lint passes for the workspace whose
  docs directory this patch touches.
- `yarn turbo run typecheck --filter=./apps/website`: types still sound.
- `yarn turbo run test --filter=./apps/website`: unit tests pass, proving zero
  regressions.
- `yarn turbo run build --filter=./apps/website`: production build succeeds.
- `git diff --stat`: confirm the change set is exactly one new file under `docs/` plus
  comment-only edits to `.github/workflows/migrations.yml` and prose-only edits to
  `apps/website/app_docs/database/production-migrations.md`. Any YAML key or shell line
  in the diff of `migrations.yml` means the patch overreached.
- `gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'`
  must **still** return only `check` and `eval-gate`. This patch must not change the
  ruleset; a four-context result here means step 7 was pulled forward and `master` is
  now locked. If that happens, revert the array immediately.
- `gh issue view 89 --json state,comments --jq '.state'`: returns `OPEN`, with the
  handoff comment present.

## Patch Scope

**Lines of code to change:** zero lines of executable code. Roughly 120 new lines of
markdown in the new SOP, about 15 comment lines in `.github/workflows/migrations.yml`,
and about 8 prose lines in `production-migrations.md`.

**Risk level:** low. Documentation and workflow comments only. The one real risk in the
surrounding work, the ruleset PUT, is explicitly out of scope and is asserted against in
the validation commands.

**Testing required:** the repo's standard gates (prettier, knip, lint, typecheck, test,
build) to prove nothing regressed, plus the two `gh` assertions confirming the patch
changed no live GitHub state beyond one issue comment. No new automated test: there is
nothing executable to test, and the spec's Test Coverage section already argues at length
why a test layer for this workflow would be worse than none.
