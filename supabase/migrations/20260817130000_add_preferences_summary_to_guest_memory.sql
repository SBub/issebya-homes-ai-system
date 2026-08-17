-- Second piece of GCA's tiered-memory redesign (see
-- 20260817120000_create_guest_memory_folds.sql and
-- apps/guest-communication-agent/src/agent/memory.ts's foldMemory/
-- maintainFoldWindow): a stable, durable-facts layer that aged-out
-- guest_memory_folds rows get distilled into once a guest has more than
-- MAX_RECENT_FOLDS (2) discrete fold rows, rather than being deleted with no
-- trace at all.
--
-- Nullable, no default: null until a guest's first distillation actually
-- happens (i.e. until their 3rd fold row is created) — most guests will
-- never accumulate enough folds to populate this at all.
--
-- Singleton per guest, same as the existing `summary` column on this table
-- (one guest_memory row per phone_number, per
-- 20260720150000_create_whatsapp_agent_tables.sql) — no new table needed.
alter table public.guest_memory
  add column preferences_summary text;
