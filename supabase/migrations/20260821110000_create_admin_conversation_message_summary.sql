-- Graceful-degradation branch: server-side replacement for
-- listConversationsWithStuckSummary's old full-message fetch (every
-- whatsapp_messages row, full `content` included, for every listed
-- conversation, just to derive one last-message row + one failed-delivery
-- boolean per conversation). This RPC does that reduction in Postgres and
-- returns exactly one row per input conversation_id — O(1) rows out
-- regardless of how long any one conversation's message history is, unlike
-- the old query it replaces.
--
-- SECURITY INVOKER (the language default — no SECURITY DEFINER here) is
-- correct: this app only ever calls it via createAdminClient()'s
-- service-role connection, which already bypasses whatsapp_messages/
-- whatsapp_conversations' RLS (see 20260720150000_create_whatsapp_agent_tables.sql)
-- the same way every other query in admin-conversations.ts does. No
-- explicit GRANT needed either, same as match_documents
-- (20260720150001_create_documents_pgvector.sql) — Postgres grants EXECUTE
-- on a new function to PUBLIC by default, and nothing here revokes it.
--
-- unnest(conversation_ids) is the input rowset, not a lookup into
-- whatsapp_conversations, so a conversation_id with zero messages still
-- produces exactly one output row (both LATERAL joins are LEFT, so a
-- conversation with no rows in whatsapp_messages simply gets nulls for the
-- last_message_* columns and false for has_failed_delivery, instead of being
-- dropped).
create or replace function public.admin_conversation_message_summary(conversation_ids uuid[])
returns table (
  conversation_id uuid,
  last_message_id uuid,
  last_message_role text,
  last_message_content text,
  last_message_created_at timestamptz,
  last_message_delivery_status text,
  has_failed_delivery boolean
)
language sql
stable
as $$
  select
    c.id as conversation_id,
    lm.id as last_message_id,
    lm.role as last_message_role,
    lm.content as last_message_content,
    lm.created_at as last_message_created_at,
    lm.delivery_status as last_message_delivery_status,
    coalesce(fd.has_failed, false) as has_failed_delivery
  from unnest(conversation_ids) as c(id)
  left join lateral (
    select m.id, m.role, m.content, m.created_at, m.delivery_status
    from public.whatsapp_messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select true as has_failed
    from public.whatsapp_messages m2
    where m2.conversation_id = c.id
      and m2.delivery_status = 'failed'
    limit 1
  ) fd on true;
$$;
