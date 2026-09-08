-- Minimal persistence for Orch-A v0.1.0:
-- last successful run timestamp (dead-man's switch) and a durable fallback
-- record for failed Telegram deliveries.

create table if not exists orch_a_runs (
  id bigserial primary key,
  ran_at timestamptz not null
);

create table if not exists orch_a_failed_deliveries (
  id bigserial primary key,
  payload jsonb not null,
  error text not null,
  created_at timestamptz not null default now()
);
