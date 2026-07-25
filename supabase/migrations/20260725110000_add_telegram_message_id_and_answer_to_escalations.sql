-- Backs the new human-in-the-loop missing_info escalation flow: instead of
-- a one-way Telegram alert with no way to reply, a missing_info escalation
-- now nudges the owner via apps/telegram-router (POST /api/escalation-nudges
-- — see @/graph/tools.ts's performEscalation) and stores that nudge's own
-- Telegram message id here. When the owner later replies to that specific
-- message with free text, telegram-router's webhook correlates the reply
-- back to this row via Telegram's own `reply_to_message.message_id` matched
-- against telegram_message_id — there is no other id in this table a
-- free-text Telegram reply could otherwise be matched against (unlike the
-- existing nudge_approve/nudge_reject buttons, which carry their own id
-- directly in callback_data).
--
-- Nullable: unpopulated for the other three escalation categories
-- (unhappy_guest, wants_human, complaint), which keep using
-- sendTelegramNotification's raw one-way alert untouched, and for any
-- missing_info escalation whose nudge send itself failed (best-effort, see
-- performEscalation — the row is still a real escalation even if the
-- Telegram push didn't happen or its message id never made it back).
--
-- bigint, not int: Telegram message ids are 32-bit-safe today but Telegram
-- itself documents them only as "Integer", and bigint costs nothing extra
-- here to be safe against that changing.
alter table public.escalations
  add column telegram_message_id bigint,
  add column answer text;

-- resolved_at already exists (see 20260720150000_create_whatsapp_agent_tables.sql)
-- but has never been set by anything — this flow is its first real writer:
-- GCA's new POST /api/escalations/[id]/resolve sets it (alongside `answer`)
-- once the owner's reply has been embedded into the documents knowledge
-- base, and telegram-router's webhook uses a non-null resolved_at to decide
-- "already handled" (idempotency against a double reply or a Telegram
-- webhook retry) before ever calling that endpoint.
