-- Persisted tool history per assistant reply (issue #113): the turn's
-- ModelMessage tail, replayed verbatim for recent turns by memory.ts.
--
-- Written to be re-runnable. The first prod apply (2026-09-22/23, run
-- 35798075273) failed at the unique index because prod held 11 assistant
-- rows sharing one trace_id: the all-zero OTel-invalid id written by
-- untraced webhook instances, i.e. 11 distinct replies, not retried writes.
-- The migration rolled back and deployed code ran without the column for
-- about 12 h; the column arrived when PR #119's push run applied this
-- migration. The delete below removed 10 of those distinct replies (test
-- data) when it ran. `if not exists` is harmless on a re-run.

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
