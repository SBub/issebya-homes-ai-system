-- Notification Center's reminders table (docs/notification-center-todo.md).
-- A reminder is due to (re)send when: not yet acknowledged, past its due_at,
-- and either never sent yet or renotify_every has elapsed since last_sent_at.
-- renotify_every = null means "send once, never repeat" (a true one-shot).
-- Recurrence (e.g. next month's CSV upload reminder) is NOT auto-regenerated
-- in v1 — a known, documented gap, not an oversight; see notification-center-todo.md.

create table if not exists reminders (
  id bigserial primary key,
  key text not null unique,
  message text not null,
  due_at timestamptz not null,
  renotify_every interval,
  last_sent_at timestamptz,
  last_message_id bigint,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

-- Seed the three known candidates from notification-center-todo.md.
insert into reminders (key, message, due_at, renotify_every)
values
  (
    'rfi_21_2027',
    'RFI-21 re-issued by Airbnb for January 2027 — download it, fill in Section VI (Portuguese tax ID and name), resubmit to Airbnb. Booking.com equivalent still unknown.',
    '2027-01-05T09:00:00Z',
    interval '3 days'
  ),
  (
    'airbnb_split_fee_pricing_2026',
    'Airbnb retires split-fee pricing for EU hosts on Oct 13 2026 — Modelo30/invoice fee formulas in docs/finance/modelo-30-filing.md and invoices-filing.md need updating before then (host commission rate changes, guest-paid derivation disappears).',
    '2026-09-15T09:00:00Z',
    interval '3 days'
  ),
  (
    'csv_upload_2026_08',
    'Upload last month''s Airbnb + Booking.com CSVs via apps/finance''s /upload page, per platform.',
    '2026-08-02T09:00:00Z',
    interval '2 days'
  )
on conflict (key) do nothing;
