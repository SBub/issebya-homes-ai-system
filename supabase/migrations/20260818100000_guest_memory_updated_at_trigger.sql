-- guest_memory.updated_at is DB-managed from here on, not app-managed: a
-- trigger sets it to now() on every UPDATE, so it stays correct regardless
-- of which code path writes the row (currently advanceGuestMemoryWatermark's
-- upsert and updateGuestMemoryPreferences's update in
-- apps/guest-communication-agent/src/lib/db.ts, neither of which sets
-- updated_at itself) — no application code needs to remember to bump it.
--
-- moddatetime is available on this Supabase Postgres instance (confirmed via
-- pg_available_extensions) and is the idiomatic Supabase pattern for this
-- exact case, so it's used here rather than a hand-rolled trigger function.
create extension if not exists moddatetime schema extensions;

create trigger guest_memory_set_updated_at
  before update on public.guest_memory
  for each row execute procedure extensions.moddatetime(updated_at);
