# Database Interaction Rules

This document defines the rules for interacting with the database. When implementing features that involve database operations, follow these guidelines.

## Migration Workflow

All schema changes go through migrations in `supabase/migrations/`.

### Creating Migrations

**Option A: Via Studio (visual)**

1. Open local Studio: http://127.0.0.1:54323
2. Make changes in Table Editor
3. Generate migration: `yarn supabase:diff -f <descriptive_name>`

**Option B: Write migration directly**

1. Create file: `yarn supabase migration new <descriptive_name>`
2. Add SQL to the generated file in `supabase/migrations/`

### Applying Changes

```bash
# Local: Reset database with all migrations + seeds
yarn supabase:reset

# Production: Push migrations only (no seeds)
yarn supabase:push
```

### Key Points

- Seeds (`supabase/seed.sql`) only run locally with `yarn supabase:reset`
- Production migrations via `yarn supabase:push` never run seeds
- Always test migrations locally before pushing to production
- Migrations are tracked and only run once per environment

---

## When You Interact with a Database

Whenever code needs to interact with a database table, follow these rules:

### 1. Table Existence Check

Before any INSERT operation:

- Check if the table exists
- If not, create it following the schema defined in the implementation spec

### 2. User/Guest Access Pattern

If the table will be accessed by user/guest (client-side or anon key):

- Create a VIEW for user/guest access
- User/guest code uses the VIEW, not the table directly
- Admin code uses the table directly with service role key

**Access Pattern:**

| Actor      | Access Method       | Supabase Key                             |
| ---------- | ------------------- | ---------------------------------------- |
| Admin      | Direct table access | Service role key (`createAdminClient()`) |
| User/Guest | View only           | Anon key (`createClient()`)              |

### 3. Token-Based Access

If user/guest needs to retrieve records:

- Add an `access_token` column (rotatable, unique)
- Use token in URLs, not UUID
- UUID is internal only (primary key), token is the public accessor

**URL Pattern:**

- Correct: `/resource/:token` (uses access_token)
- Incorrect: `/resource/:id` (exposes UUID)

### 4. RLS Policies

- Enable Row Level Security on the table
- User/guest: SELECT only, must match token
- Admin: Full access via service role (bypasses RLS)

### 5. Token Rotation

- Token can be regenerated without changing UUID
- Provides ability to invalidate old links
- Admin can rotate tokens to revoke access

## Schema Template

When creating a new table that user/guest will access:

```sql
-- Table (admin access only via service role key)
CREATE TABLE table_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  -- ... other fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- View for user/guest access (via anon key)
CREATE VIEW table_name_public AS
  SELECT access_token, [safe columns to expose...]
  FROM table_name;

-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow select (view handles token filtering)
CREATE POLICY "Allow public select" ON table_name
  FOR SELECT
  USING (true);

-- RLS Policy: Admin insert/update (service role bypasses RLS anyway)
CREATE POLICY "Allow service role insert" ON table_name
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role update" ON table_name
  FOR UPDATE
  USING (true);
```

## Token Rotation SQL

To rotate a token (invalidate old links):

```sql
UPDATE table_name
SET access_token = encode(gen_random_bytes(32), 'hex')
WHERE id = 'uuid-here';
```

## Supabase Client Usage

Use the appropriate client based on the context:

```typescript
// For admin operations (service role key)
import { createAdminClient } from '@/lib/supabase';
const supabase = createAdminClient();

// For user/guest operations (anon key)
import { createClient } from '@/lib/supabase';
const supabase = createClient();
```

## Pre-Implementation Checklist

Before writing code that interacts with a database:

- [ ] Table schema defined in implementation spec
- [ ] Check if table exists (create if not)
- [ ] View created for user/guest access (if applicable)
- [ ] `access_token` column added (if user/guest retrieves records)
- [ ] RLS policies configured
- [ ] URL uses token, not UUID (if user/guest facing)
- [ ] Correct Supabase client used (admin vs user/guest)
