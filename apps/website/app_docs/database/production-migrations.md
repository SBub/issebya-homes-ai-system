# Production Database Migrations

How a schema change reaches the hosted production project, and how the pipeline
stops one from quietly failing to.

CI owns the production apply. The manual `yarn supabase:push` route further down
is still documented and still works, but it is the exception now: the local
route, and the emergency route when CI itself is broken.

## The CI path (the normal route)

`.github/workflows/migrations.yml` owns everything that touches prod. Read its
header comment before changing it; it is a reasoned record of an outage, not
decoration.

**`master` is the only branch whose migrations may reach prod.** Prod is deployed
from `master`, so the `push` job pins `ref: master` even on a manual dispatch.
A migration sitting on `develop` has not been deployed, however green its PR was.

The lifecycle of one migration file:

| Stage                       | Job                  | What it does                                                                   |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| PR into `develop`           | `dry-run`            | Replays the full history onto a fresh ephemeral Postgres. Catches broken SQL.   |
| PR `develop` -> `master`    | `drift-check`        | Asks whether prod already matches `master` as it stands, before this PR lands.  |
| PR `develop` -> `master`    | `prod-migration-sync`| Asks whether, after this PR lands, the only thing prod lacks is what this adds. |
| Merge to `master`           | `push`               | `supabase db push` applies the pending migrations to prod.                      |

### Why the gate exists

`push` runs *after* the merge, so a failing `push` blocks nothing on its own: the
migration is already in git and the PR is already green. That is exactly what
happened between 2026-09-10 and 2026-09-21. The `push` job broke on a Supabase
Management API authorization failure, went red on `master` (a branch nobody
watches, since `develop` is this repo's GitHub default), and migrations kept
merging on top of it.

`prod-migration-sync` is the correction. It runs on every PR into `master` and
makes two assertions:

1. **Nothing already on `master` may be missing from prod.** A non-empty result
   means a `push` failed or never ran, so the delivery pipeline is broken and the
   next promotion must not stack on top of it.
2. **Prod may hold no version this PR's tree lacks a file for.** This catches
   history repaired outside the repo, and PRs that delete a migration prod has
   already applied.

It also prints, without failing, the migrations the merge is about to apply, so
the reviewer can see what the promotion does to prod before approving it.

Both `prod-migration-sync` and `drift-check` are intended to be required status
checks on the `protect-master` ruleset, which is what turns a broken delivery
pipeline into a blocked merge button rather than a red X nobody sees.

**As of 2026-09-21 neither is a required check yet.** The `protect-master` ruleset
still requires only `check` and `eval-gate`, so until that changes a broken
delivery pipeline is still only a red X, not a blocked merge button. The reason is
one missing repo secret: `SUPABASE_DB_URL` does not exist, and creating it needs the
prod database password, which only a Supabase org owner can read. The steps that
finish the job, in the order they have to happen, are in
`docs/prod-migration-gate-handoff-sop.md`.

Neither job may ever be given a `paths:` filter or an `if` gate on the `changes` job:
a skipped job counts as satisfying a required check, and a workflow suppressed
by a `paths:` filter never reports its check at all. Both are commented in the
job for that reason.

### Do not run SQL by hand in the dashboard

Running a statement in the Supabase SQL editor changes prod without writing a
`supabase_migrations.schema_migrations` row. The privilege or column is live, the
repo has no record that prod has it, and every later comparison disagrees with
reality. If you have already done it (as was done on 2026-09-21 for
`20260921092000_grant_anon_select_documents.sql`, because CI could not deliver
it), still land the migration file through the normal route. Idempotent SQL
re-runs harmlessly and the merge finally writes the missing row.

### When the prod apply fails

1. Dispatch the read-only probe: **Actions -> Supabase Migrations -> Run workflow
   -> `job=diagnose`**. It prints the installed CLI version, the project list, and
   the HTTP status of the two Management API endpoints `supabase link` calls, plus
   a guide to reading those codes. It never prints a response body, because the
   `api-keys` endpoint returns live project keys.
2. Dispatch `job=drift-check` to confirm whether prod and `master` agree.
3. Once the cause is fixed, dispatch `job=push` to apply what is pending. This is
   the retry path, and it exists so that re-running a failed apply does not
   require fabricating a commit on `master`.

## The manual path (local, and emergencies)

### One-Time Setup

Link to your production project:

```bash
yarn supabase link --project-ref <project-ref>
```

Find your project ref in the Supabase Dashboard URL:
`https://supabase.com/dashboard/project/<project-ref>`

### Deployment Steps

#### 1. Develop Locally

```bash
# Start local Supabase
yarn supabase:start

# Make schema changes via Studio or write migrations
yarn supabase migration new <name>

# Test locally
yarn supabase:reset
```

#### 2. Preview Changes (Dry Run)

```bash
# See what would be applied to production
yarn supabase:push --dry-run
```

#### 3. Deploy to Production

```bash
# Apply migrations to production
yarn supabase:push
```

### Local vs Production

| Aspect     | Local (`reset`)   | Production (`push`) |
| ---------- | ----------------- | ------------------- |
| Migrations | Applied           | Applied             |
| Seed data  | **Yes**           | **No**              |
| Data reset | Yes (destructive) | No (incremental)    |

#### What Gets Deployed

- All migration files in `supabase/migrations/` that haven't been applied yet
- Migrations are tracked in the `supabase_migrations` table

#### What Does NOT Get Deployed

- Seed data (`supabase/seed.sql`) - this is for local development only
- Any local-only changes not captured in migrations

### Rollback

Supabase doesn't support automatic rollbacks. If you need to rollback:

1. Create a new migration that reverses the changes:
   ```bash
   yarn supabase migration new rollback_<name>
   ```
2. Add the reverting SQL to the migration file
3. Apply: `yarn supabase:push`

### Troubleshooting

| Error                       | Solution                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| "Project not linked"        | `yarn supabase link --project-ref <ref>`                                 |
| "Permission denied"         | `yarn supabase login`                                                    |
| "Migration already applied" | Migration was already run - check production `supabase_migrations` table |
| "Connection refused"        | Check your network and Supabase project status                           |

### Best Practices

1. **Always test locally first** - Run `yarn supabase:reset` before pushing
2. **Use descriptive migration names** - e.g., `add_bookings_status_column`
3. **Review dry-run output** - Always run `--dry-run` before pushing
4. **Don't modify applied migrations** - Create new migrations instead
5. **Coordinate with team** - Communicate before pushing migrations
