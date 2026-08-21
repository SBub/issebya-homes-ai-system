-- Postgres-backed recovery mechanism (graceful-degradation branch): tracks
-- every owner approve/reject-or-answer decision GCA is waiting on, so a
-- small admin UI (built in a follow-up step, not this migration) can
-- list/flag stuck conversations and let an operator manually resolve them.
--
-- Narrower than the old, deliberately-removed escalations table (see
-- 20260804100000_drop_escalations_table.sql) — this only covers the two
-- tools that are genuinely approve/reject-or-answer-shaped (missing_info,
-- send_booking_link). wants_human is a one-way alert with no decision to
-- await and gets no row here (it never passes a correlationId to the
-- nudge — see apps/guest-communication-agent's owner-nudge.ts).
--
-- context: captures whatever structured data the manual-resolve action
-- (POST /api/admin/pending-decisions/[id]/actions/resolve) needs to act
-- without re-parsing it back out of `reason`, which is prose meant for a
-- human, not structured data:
--   - send_booking_link: the tool call's real args (guestName/room/checkIn/
--     checkOut) at insert time, so the same booking URL runSendBookingLink
--     would have built can still be rebuilt later even if the original
--     Inngest run is dead.
--   - missing_info: the owner's actual answer text, added once it's known —
--     set alongside relayed_at by the owner-nudges answer route, since the
--     answer doesn't exist yet when this row is first inserted.
--
-- relayed_at vs resolved_at: relayed_at is set once the owner's real
-- decision/answer has been relayed into the (possibly-dead) suspended
-- Inngest run via its wake event. A run that died before ever consuming
-- that wake event leaves relayed_at set but resolved_at forever null —
-- exactly the "relayed but never consumed" stuck signal
-- pending_owner_decisions_stuck_idx below exists to find cheaply.
--
-- resolution: 'answered'/'approved'/'rejected' are the three real decision
-- outcomes a live run can reach on its own (mirroring approval-gate.ts's own
-- gca.approval.decision values, plus missing_info's answered case);
-- 'timeout' is Inngest's step.waitForEvent giving up waiting; 'manually_resolved'
-- is this table's own purpose-built escape hatch, set only by the resolve
-- action above when an operator has confirmed the original run is dead.
--
-- Admin-client only (createAdminClient, same as every other table this app
-- writes through @supabase/supabase-js) — no anon-facing access, so RLS is
-- enabled with no policies, same posture as guest_memory_folds.
create table public.pending_owner_decisions (
  id              uuid        primary key default gen_random_uuid(),
  correlation_id  text        not null unique,
  tool_name       text        not null check (tool_name in ('missing_info', 'send_booking_link')),
  conversation_id uuid        references public.whatsapp_conversations(id) on delete set null,
  phone           text        not null,
  reason          text,
  context         jsonb,
  sent_at         timestamptz not null default now(),
  relayed_at      timestamptz,
  resolved_at     timestamptz,
  resolution      text        check (resolution in ('answered', 'approved', 'rejected', 'timeout', 'manually_resolved'))
);

-- correlation_id's own `unique` constraint above already gives it a real
-- index — no separate one needed.

-- Backs the "relayed but never consumed" stuck query (GET
-- /api/admin/conversations and the pending-decisions resolve route).
-- Partial on resolved_at is null so it only ever indexes the rows that
-- still matter for that query, not the whole (eventually large) table.
create index pending_owner_decisions_stuck_idx
  on public.pending_owner_decisions (relayed_at)
  where resolved_at is null;

alter table public.pending_owner_decisions enable row level security;

revoke all on public.pending_owner_decisions from anon, authenticated;
