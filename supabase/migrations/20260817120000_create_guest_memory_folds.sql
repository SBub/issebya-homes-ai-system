-- First piece of GCA's tiered-memory redesign (see
-- apps/guest-communication-agent/src/agent/memory.ts's foldMemory): keep the
-- last few folds as discrete, independent rows instead of merging every fold
-- into guest_memory's single ever-growing summary blob, which re-compresses
-- already-compressed prose on every fold and loses fidelity/chronological
-- order as folds accumulate.
--
-- Purely additive right now — nothing reads this table yet. guest_memory's
-- own summary/summarized_through_message_id write path (foldMemory's
-- existing summarizeConversation + upsertGuestMemory call) is unchanged and
-- remains the only thing loadMemory's contextBlock reads. A later task wires
-- up reading these rows and distilling anything older than the last few
-- folds into a separate stable preferences layer; this migration only adds
-- the write-side table those later tasks will build on.
--
-- Not unique on phone_number, unlike guest_memory: one row per fold event,
-- so a guest accumulates multiple rows over time.
--
-- message_id_from/message_id_to: same nullable-FK-with-ON DELETE SET NULL
-- pattern as guest_memory.summarized_through_message_id (see
-- 20260804090000_add_summarized_through_message_id_to_guest_memory.sql) and
-- for the same reason — a whatsapp_conversations cascade-delete removing the
-- referenced whatsapp_messages row must not take this fold's summary text
-- down with it, only the now-dangling message reference should clear.
-- Together they record which stretch of whatsapp_messages this specific
-- fold covers, the same role summarized_through_message_id plays today but
-- scoped per-fold-row instead of one running watermark.
create table public.guest_memory_folds (
  id              uuid        primary key default gen_random_uuid(),
  phone_number    text        not null,
  summary_text    text        not null,
  message_id_from uuid        references public.whatsapp_messages(id) on delete set null,
  message_id_to   uuid        references public.whatsapp_messages(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Later task's "give me the last N folds for this phone, newest first" query.
create index guest_memory_folds_phone_number_created_at_idx
  on public.guest_memory_folds (phone_number, created_at desc);

-- Same RLS posture as guest_memory and the rest of this schema: enabled,
-- no policies, admin-client-only access (see
-- 20260720150000_create_whatsapp_agent_tables.sql).
alter table public.guest_memory_folds enable row level security;

revoke all on public.guest_memory_folds from anon, authenticated;
