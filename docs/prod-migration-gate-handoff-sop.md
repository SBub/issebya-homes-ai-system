# Prod migration gate: handoff to a Supabase org owner

SOP for finishing the production migration gate started in issue #89. Written to be
followed, not read. It is a handoff: one repo secret is missing, every remaining step
of the issue sits behind it, and its value is the prod Supabase database password,
which only an owner of the `issebya` Supabase org can read. No agent, no commit and no
branch in this repo can produce it. Nothing below can start until someone with that
access runs step 1.

## What is blocked

Stated as fact, with the evidence, as of 2026-09-21.

- **`SUPABASE_DB_URL` does not exist as a repo secret.** `gh secret list` returns
  `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT_ID`, `OPENROUTER_API_KEY`,
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and nothing else. `push`,
  `drift-check` and `prod-migration-sync` all read it, and all three now fail closed
  at a `Require SUPABASE_DB_URL` step rather than connecting to whatever libpq's
  defaults point at.
- **Dispatched `drift-check` run `35607215583`** (headSha `cb6fcc5`, 2026-09-21
  13:41Z) fails at that `Require SUPABASE_DB_URL` step. That is the guard working as
  designed. It is also the spec's "green dispatched drift-check" precondition for the
  ruleset change, on the record as unmet.
- **`20260921092000_grant_anon_select_documents.sql` is still stranded.** The newest
  `migrations.yml` run on `master` is still `34486392180` (2026-09-10, failure). Prod
  holds the three `GRANT`s, applied by hand in the SQL editor, with no
  `supabase_migrations.schema_migrations` row to say so.
- **The `protect-master` ruleset (`22536056`) still requires only `check` and
  `eval-gate`.** Neither migration job is a required status check.
- **Three of issue #89's five acceptance criteria are consequently false:** `push` is
  not green on `master` with `20260921092000` recorded; the two jobs are not required
  checks; and a PR into `master` carrying an unapplied local migration can still
  merge.

## The sequence

Six steps, in this order and no other. Read the callout under step 5 before starting.

### 1. Create the `SUPABASE_DB_URL` repo secret

```bash
gh secret set SUPABASE_DB_URL
```

Value shape:

```
postgresql://postgres.<project-ref>:<percent-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Two gotchas, each worth a debugging round:

- **The pooler host, not the direct host.** `db.<ref>.supabase.co` is IPv6-only and
  GitHub-hosted runners are IPv4-only, so the direct host does not resolve on a runner
  at all.
- **Session mode on port 5432, not transaction mode on 6543.** Migrations issue
  session-level statements that transaction pooling refuses.

Percent-encode the password before storing it.

### 2. Dispatch `drift-check` and confirm it is green

```bash
gh workflow run migrations.yml --ref <branch> -f job=drift-check
gh run watch <run-id>
```

It must come back green against `master` as it stands. This is the gate on everything
below: if it is red, stop here and fix the secret. Do not continue.

### 3. Land the branch on `develop`, then open the promotion PR

Land `chore/issue-89-adw-3874a012-require-prod-migration-sync` on `develop` first,
then open the `develop`-to-`master` promotion PR. On that PR confirm with
`gh pr checks <pr>` that `check`, `eval-gate`, `drift-check` and `prod-migration-sync`
all report, and that **none of them reports `skipped`**.

Expected result: assertion 1 empty, assertion 2 empty, and the informational line
naming `20260921092000` as the one migration the merge will apply.

### 4. Merge, and watch the apply land

Merge the promotion PR. Watch the `push` run apply `20260921092000`: the three
`GRANT`s re-run harmlessly over the hand-applied state, and the
`schema_migrations` row is finally written. Then re-dispatch `job=drift-check` and
confirm there is no drift.

### 5. Only now extend the ruleset

```bash
gh api repos/SBub/issebya-homes-ai-system/rulesets/22536056
```

Edit **only** the `required_status_checks` array with `jq`, adding
`{"context":"drift-check"}` and `{"context":"prod-migration-sync"}`, then PUT the
whole body back so that the `deletion`, `non_fast_forward` and `pull_request` rules,
`strict_required_status_checks_policy: false` and `do_not_enforce_on_create: false`
all survive the round trip.

The contexts are the **job ids** verbatim. Neither job sets a `name:`, and a typo
produces a context that never reports, which blocks `master` permanently. Re-read the
ruleset afterwards and confirm all four contexts are present.

> **Why the order is not negotiable.** The `protect-master` ruleset has
> `bypass_actors: []` and `current_user_can_bypass: "never"`. Requiring a check that
> cannot go green locks `master` for everyone, with no admin override to undo it from
> the merge side. Steps 1 to 4 exist to make step 5 safe: they are what proves the two
> jobs can go green before anything depends on them going green. Do not pull step 5
> forward.

### 6. Prove the gate blocks

A gate nobody has seen fail is a gate nobody knows works. Cut a throwaway branch off
`master` and open a draft PR into `master` that deletes
`supabase/migrations/20260828120000_grant_service_role_all_public.sql`, a version prod
holds. Assertion 2 must fail and the merge button must be blocked.

Record that run id in the `prod-migration-sync` job's header comment in
`.github/workflows/migrations.yml`, next to the assertion it exercised. Then close the
PR without merging and delete the branch.

Step 6 needs step 5, because "the merge button is blocked" is a property of the
ruleset, not of the workflow.

## Pointers

- `.github/workflows/migrations.yml`, header block: the full incident record. The
  `supabase link` 403, the three diagnose runs that pinned it to
  `/v1/projects/{ref}/api-keys?reveal=true`, and why `--db-url` replaced `link` in the
  three prod-touching jobs.
- `apps/website/app_docs/database/production-migrations.md`: the migration lifecycle
  table and the CI path from a developer's point of view.
- `specs/issue-89-adw-3874a012-sdlc_planner-require-prod-migration-sync.md`: the
  original spec, with steps 4 to 8 written out in full. Steps 1 to 6 above are those
  four steps plus the secret they all wait on.
