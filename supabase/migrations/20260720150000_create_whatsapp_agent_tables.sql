-- Ported verbatim from issebya-homes-website's
-- supabase/migrations/20260702000001_whatsapp_agent.sql — GCA's own 5
-- tables, self-contained (all FKs point at whatsapp_conversations.id in
-- this same file). See apps/guest-communication-agent's own docs for what
-- reads/writes each of these.

-- whatsapp_conversations: one row per chat session with a guest
CREATE TABLE public.whatsapp_conversations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'closed')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

-- look up active conversation by phone quickly
CREATE INDEX idx_whatsapp_conversations_phone_status
  ON public.whatsapp_conversations(phone_number, status);

-- whatsapp_messages: every user + assistant message in a conversation
CREATE TABLE public.whatsapp_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  role             text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_messages_conversation_created
  ON public.whatsapp_messages(conversation_id, created_at);

-- guest_memory: distilled facts about a guest, survives across conversations.
-- Currently unpopulated (no writer anywhere ported this session either) —
-- carried over for schema parity, not because anything writes to it yet.
CREATE TABLE public.guest_memory (
  phone_number  text        PRIMARY KEY,
  summary       text        NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- escalations: owner alert log (real Telegram notification sent alongside this insert)
CREATE TABLE public.escalations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES public.whatsapp_conversations(id),
  phone_number     text        NOT NULL,
  reason           text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);

-- booking_link_requests: captures intent to send a booking link
CREATE TABLE public.booking_link_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES public.whatsapp_conversations(id),
  phone_number     text        NOT NULL,
  guest_name       text,
  room             text,
  check_in         date,
  check_out        date,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- server-side only: no anon or authenticated user access
ALTER TABLE public.whatsapp_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_memory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_link_requests    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_conversations   FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_messages        FROM anon, authenticated;
REVOKE ALL ON public.guest_memory             FROM anon, authenticated;
REVOKE ALL ON public.escalations              FROM anon, authenticated;
REVOKE ALL ON public.booking_link_requests    FROM anon, authenticated;
