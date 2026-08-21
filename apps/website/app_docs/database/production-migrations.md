# Production Database Migrations

Manual guide for deploying database changes to production.

## One-Time Setup

Link to your production project:

```bash
yarn supabase link --project-ref <project-ref>
```

Find your project ref in the Supabase Dashboard URL:
`https://supabase.com/dashboard/project/<project-ref>`

## Deployment Steps

### 1. Develop Locally

```bash
# Start local Supabase
yarn supabase:start

# Make schema changes via Studio or write migrations
yarn supabase migration new <name>

# Test locally
yarn supabase:reset
```

### 2. Preview Changes (Dry Run)

```bash
# See what would be applied to production
yarn supabase:push --dry-run
```

### 3. Deploy to Production

```bash
# Apply migrations to production
yarn supabase:push
```

## Local vs Production

| Aspect     | Local (`reset`)   | Production (`push`) |
| ---------- | ----------------- | ------------------- |
| Migrations | Applied           | Applied             |
| Seed data  | **Yes**           | **No**              |
| Data reset | Yes (destructive) | No (incremental)    |

### What Gets Deployed

- All migration files in `supabase/migrations/` that haven't been applied yet
- Migrations are tracked in the `supabase_migrations` table

### What Does NOT Get Deployed

- Seed data (`supabase/seed.sql`) - this is for local development only
- Any local-only changes not captured in migrations

## Rollback

Supabase doesn't support automatic rollbacks. If you need to rollback:

1. Create a new migration that reverses the changes:
   ```bash
   yarn supabase migration new rollback_<name>
   ```
2. Add the reverting SQL to the migration file
3. Apply: `yarn supabase:push`

## Troubleshooting

| Error                       | Solution                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| "Project not linked"        | `yarn supabase link --project-ref <ref>`                                 |
| "Permission denied"         | `yarn supabase login`                                                    |
| "Migration already applied" | Migration was already run - check production `supabase_migrations` table |
| "Connection refused"        | Check your network and Supabase project status                           |

## Best Practices

1. **Always test locally first** - Run `yarn supabase:reset` before pushing
2. **Use descriptive migration names** - e.g., `add_bookings_status_column`
3. **Review dry-run output** - Always run `--dry-run` before pushing
4. **Don't modify applied migrations** - Create new migrations instead
5. **Coordinate with team** - Communicate before pushing migrations
