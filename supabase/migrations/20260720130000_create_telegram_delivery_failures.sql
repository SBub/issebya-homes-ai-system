-- Shared, router-owned durable fallback for failed Telegram sends. Replaces
-- apps/orch-a's old orch_a_failed_deliveries (left in place, historical data
-- only, nothing writes to it anymore) now that apps/telegram-router is the
-- sole Telegram sender for the whole system: `/social` replies, reminder
-- sends (check-reminders), and the digest send (check-digest) all write here
-- on failure, distinguished by `source`.

create table if not exists telegram_delivery_failures (
  id bigserial primary key,
  source text not null,
  payload text not null,
  error text not null,
  created_at timestamptz not null default now()
);
