-- A guest turn's own AI SDK messages (assistant tool calls, tool results,
-- the final reply text), stored as { schema_version, messages } so the next
-- turn replays what the agent actually did rather than just what it said.
--
-- Nullable, and only ever set on role='assistant' rows written by a guest
-- turn. User rows, admin-resend rows and rows written before this column
-- existed stay null and replay as plain text.
alter table public.whatsapp_messages
  add column turn_messages jsonb;

-- One assistant row per guest-turn trace: makes the record-reply write
-- idempotent when Inngest retries a step whose insert landed but whose
-- response was lost. Rows with a null trace_id (admin resends) never
-- conflict.
create unique index whatsapp_messages_assistant_trace_id_key
  on public.whatsapp_messages (trace_id)
  where role = 'assistant' and trace_id is not null;
