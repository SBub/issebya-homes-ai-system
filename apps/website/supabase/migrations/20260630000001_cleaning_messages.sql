-- cleaning_messages: all communication with Keila (inbound + outbound)
CREATE TABLE public.cleaning_messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  direction     text        NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  type          text        NOT NULL CHECK (type IN ('schedule', 'reminder', 'adhoc', 'reply')),
  draft_text    text        NOT NULL,
  final_text    text,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'cancelled', 'sent', 'received')),
  scheduled_for timestamptz,
  wa_message_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

ALTER TABLE public.cleaning_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cleaning_messages FROM anon;

CREATE OR REPLACE FUNCTION public.update_cleaning_messages_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cleaning_messages_updated_at
  BEFORE UPDATE ON public.cleaning_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_cleaning_messages_updated_at();

-- message_edits: captures every edit to an outbound draft (future memory loop input)
CREATE TABLE public.message_edits (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid        NOT NULL REFERENCES public.cleaning_messages(id) ON DELETE CASCADE,
  original_draft text        NOT NULL,
  edited_text    text        NOT NULL,
  edit_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.message_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_edits FROM anon;
