-- Persisted tool history per assistant reply (issue #113): the turn's
-- ModelMessage tail, replayed verbatim for recent turns by memory.ts.
--
-- Written to be re-runnable. The first prod apply (2026-09-23, run
-- 35798075273) failed at the unique index because prod already held
-- assistant rows sharing a trace_id — the duplicate writes from retried
-- record-reply steps that the index exists to prevent — and rolled the
-- whole migration back while the new code was already deployed. The column
-- was then added by hand to restore service, so `if not exists` is
-- load-bearing, and the duplicates are removed here before the index is
-- created, keeping the earliest row per trace (same content; the reply the
-- guest received).

alter table public.whatsapp_messages
  add column if not exists turn_messages jsonb;

delete from public.whatsapp_messages m
using public.whatsapp_messages k
where m.role = 'assistant'
  and k.role = 'assistant'
  and m.trace_id is not null
  and m.trace_id = k.trace_id
  and m.id <> k.id
  and (m.created_at, m.id) > (k.created_at, k.id);

create unique index if not exists whatsapp_messages_assistant_trace_id_key
  on public.whatsapp_messages (trace_id)
  where role = 'assistant' and trace_id is not null;
