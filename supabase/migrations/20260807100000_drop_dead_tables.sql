-- Drop tables left over from apps that were removed entirely.
--
-- reminders: apps/notifications' table (created by
-- 20260720120000_create_reminders.sql). apps/notifications has been
-- deleted; nothing reads or writes this table anymore.
drop table public.reminders;

-- orch_a_runs and orch_a_failed_deliveries: apps/orch-a's tables (created by
-- 20260718123130_create_orch_a_tables.sql). apps/orch-a has been deleted.
-- orch_a_failed_deliveries was already superseded by
-- telegram_delivery_failures, which is still live and untouched here.
drop table public.orch_a_runs;
drop table public.orch_a_failed_deliveries;

-- health_check_state: written/read only by
-- apps/telegram-router/src/lib/telegram/health-monitor.ts (created by
-- 20260720140000_create_health_check_state.sql). That file, and the whole
-- health-monitor feature, has been deleted.
drop table public.health_check_state;
