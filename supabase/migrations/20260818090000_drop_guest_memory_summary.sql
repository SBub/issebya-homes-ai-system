-- guest_memory.summary (from 20260720150000_create_whatsapp_agent_tables.sql)
-- is dropped — the tiered-memory redesign (20260817120000_create_guest_memory_folds.sql,
-- 20260817130000_add_preferences_summary_to_guest_memory.sql) replaced it
-- with guest_memory_folds + guest_memory.preferences_summary, and nothing
-- has read or written this column since. Confirmed with the app owner that
-- no backfill of existing summary data is needed.
alter table public.guest_memory
  drop column summary;
