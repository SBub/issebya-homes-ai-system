-- Renames whatsapp_messages.langsmith_run_id to trace_id.
--
-- LangSmith was fully removed from apps/guest-communication-agent; this
-- column has held a Braintrust trace id (see turnTraceContext in
-- src/lib/tracing.ts) since that migration, but kept its old LangSmith-era
-- name until now. This migration just catches the column name up to what
-- it actually stores — no behavior change, no data change.
alter table public.whatsapp_messages rename column langsmith_run_id to trace_id;
