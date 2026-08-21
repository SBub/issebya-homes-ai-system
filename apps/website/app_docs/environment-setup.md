# Environment Setup Guide

This document defines the required environment variables and setup for development and production.

## Development Environment (Local Supabase)

Development uses a local Supabase instance that starts automatically with `./scripts/start.py`.

### Setup

1. Start the app: `./scripts/start.py` (auto-starts Supabase)
2. Get local credentials: `yarn supabase:status --output env`
3. Create `.env.development`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<ANON_KEY from output>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from output>
```

Note: Local keys are deterministic - they stay the same every time you start Supabase.

### Environment Loading

- `yarn dev` → loads `.env.development` (local Supabase)
- `yarn build` → loads `.env.production` (remote Supabase)

## Production Environment

For production, use the remote Supabase project:

1. Get credentials from Supabase Dashboard > Settings > API
2. Create `.env.production` with the production values
3. Never commit these files to git

See `app_docs/database/production-migrations.md` for deploying database changes.

## Required Variables

| Variable                    | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `SUPABASE_URL`              | Supabase project URL                                 |
| `SUPABASE_ANON_KEY`         | Public anon key for client-side/guest access         |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations (bypasses RLS) |

## AI Agent Rules

AI agents must **NEVER** read the following files:

- `.env`
- `.env.development`
- `.env.production`
- Any file matching `.env*` pattern

These files contain secrets and credentials. If you need to know which environment variables are required, refer to this document instead.
