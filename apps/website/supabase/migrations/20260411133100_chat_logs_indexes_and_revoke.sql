-- Drop stale channel index (column was dropped)
DROP INDEX IF EXISTS public.idx_chat_logs_channel;

-- Composite index for gap detection query 1: all sessions ordered by last message
CREATE INDEX idx_chat_logs_session_created_at
  ON public.chat_logs (session_id, created_at DESC);

-- Revoke table-level SELECT from anon on admin-only tables
-- RLS alone returns empty on SELECT; REVOKE makes it raise 42501 (consistent with INSERT)
REVOKE ALL ON public.chat_logs FROM anon;
REVOKE ALL ON public.admin_logs FROM anon;
REVOKE ALL ON public.outreach_history FROM anon;
REVOKE ALL ON public.reference_guides FROM anon;
REVOKE ALL ON public.knowledge_gap_topics FROM anon;
REVOKE ALL ON public.processed_sessions FROM anon;
REVOKE ALL ON public.bookings FROM anon;
