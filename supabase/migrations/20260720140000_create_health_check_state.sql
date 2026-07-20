-- Per-service liveness state for apps/telegram-router's health monitor
-- (check-health cron + /heartbeat command). Durable, not in-process memory,
-- because the router restarts often in dev — an in-memory map would forget
-- known-bad state on every restart and either re-alert immediately or
-- silently swallow a real recovery alert. Backs the alert-on-transition-only
-- rule: one alert when a service goes down, silence while it stays down,
-- one recovery alert when it comes back, silence while it stays up.

create table if not exists health_check_state (
  id bigserial primary key,
  service text not null unique,
  is_healthy boolean not null default true,
  last_checked_at timestamptz not null,
  last_status_change_at timestamptz not null,
  last_error text,
  consecutive_failures integer not null default 0
);
