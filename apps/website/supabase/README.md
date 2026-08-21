# Supabase

PostgreSQL + pgvector. Migrations, RLS policies, pgTAP tests, and edge functions. All commands run from repo root.

## Commands

```bash
yarn supabase:start     # start local (Docker required)
yarn supabase:stop      # stop
yarn supabase:status    # URLs + keys
yarn supabase:diff      # generate migration from Studio changes
yarn supabase:migrate   # deploy to production
yarn test:db            # run pgTAP tests (local Supabase must be running)
```

## Local setup

```bash
yarn supabase:start
yarn supabase:status    # copy keys → apps/website/.env.development
```

Studio: http://127.0.0.1:54323

## Tables

| Table                  | Access                          | Used by                          | Purpose                                   |
| ---------------------- | ------------------------------- | -------------------------------- | ----------------------------------------- |
| `bookings`             | service role only               | `apps/website` API routes        | Room bookings — created on Stripe payment |
| `booking_availability` | anon (view)                     | `apps/website` availability API  | Safe read-only view: confirmed dates only |
| `documents`            | anon SELECT, service role write | `issebya-homes-ai-system` (external repo) | RAG knowledge base (pgvector embeddings)  |
| `channels`             | service role only               | none — manual                    | Outreach channels (WhatsApp, Instagram)   |
| `reference_guides`     | service role only               | none — manual                    | Copy + visual memory for outreach         |

## RLS model

All tables: RLS enabled. Admin-only tables: zero policies + `REVOKE ALL FROM anon`.

```
anon key     → booking_availability (SELECT only)
             → documents (SELECT only, via match_documents RPC)
             → everything else → 42501

service role → bypasses RLS → full access everywhere
```

## Clients

```ts
import { createClient } from '@issebya/shared/supabase'; // anon key
import { createAdminClient } from '@issebya/shared/supabase'; // service role
```

Use `createAdminClient()` for all server-side writes. `createClient()` only for `booking_availability` and `documents`.

## Schema changes

**Option A — write SQL:**

```bash
supabase migration new <name>   # creates timestamped file
# edit file, then:
npx supabase migration up       # apply locally (no data loss)
```

**Option B — Studio UI:**

```bash
# make changes in Studio, then:
yarn supabase:diff              # generates migration file
npx supabase migration up
```

Never use `yarn supabase:reset` — drops all local data.

## Apply pending migrations locally

```bash
npx supabase migration up
```

If ghost migrations block it:

```bash
npx supabase migration list                                    # find REMOTE ONLY rows
npx supabase migration repair --status reverted <timestamp>    # repeat per ghost
npx supabase migration up
```

## Deploy to production

```bash
yarn supabase:migrate --dry-run   # preview
yarn supabase:migrate             # apply
```

## Tests

pgTAP. Each file wraps in `BEGIN/ROLLBACK` — no data left behind.

```bash
yarn test:db    # local Supabase must be running
```

| Test file                         | What it covers                            |
| --------------------------------- | ----------------------------------------- |
| `tests/bookings.test.sql`         | Bookings table RLS, constraints, triggers |
| `tests/channels.test.sql`         | Channels table RLS and schema             |
| `tests/reference_guides.test.sql` | Reference guides RLS and schema           |

## Seed data

`seed.sql` = knowledge base (channels, reference guides, property docs). The `channels`/`reference_guides` block is static and manually maintained — edit the INSERT statements in `seed.sql` directly and commit.

## Backups

Production: GitHub Actions, daily midnight CET, 90-day retention.
Dev: not backed up — reproducible from migrations + seed.

## Rollback

No auto-rollback. Create a new migration with reverting SQL.
