-- Backs the missing_info escalation re-invocation flow: once the owner
-- answers on Telegram, GCA re-invokes its own agent graph using the guest's
-- actual original message text as the turn's input, not escalations.reason
-- (the model's own paraphrase of the guest's question). trigger_message_id
-- is that original message's real whatsapp_messages.id, captured at
-- escalation time (see @/graph/tools.ts's performEscalation and
-- apps/guest-communication-agent's webhook route, which threads it through
-- graph.invoke()'s configurable.triggerMessageId) rather than reconstructed
-- later from timestamps.
--
-- Nullable: unpopulated for old rows that predate this column, and for any
-- future deterministic safety-net escalation (agent.ts's step-cap /
-- empty-reply branches) that somehow lacks a clean trigger message — those
-- stay null rather than forcing a fabricated reference. GCA's
-- POST /api/escalations/[id]/resolve skips the re-invocation gracefully
-- when this is null.
alter table public.escalations
  add column trigger_message_id uuid references public.whatsapp_messages(id);
