-- Cross-request trace-anchor handoff for missing_info's owner-reply flow
-- (apps/guest-communication-agent's src/lib/tracing.ts's
-- recordMissingInfoTraceAnchor/consumeMissingInfoTraceAnchor). No
-- business-logic correlation lives here — correlationId's real job (tying a
-- later Telegram reply back to the specific suspended run-guest-turn
-- Inngest function) still happens with zero DB rows, via the
-- `[ref:<correlationId>]` tag alone (see owner-nudge.ts/missing-info.ts).
-- This table exists purely so the owner-nudges answer route (a separate
-- HTTP request, sometimes hours later, possibly a different server
-- instance) can find the real gen_ai.tool.missing_info span's
-- {traceId, spanId} and nest the KB-embedding step's span underneath it,
-- instead of starting its own disconnected trace root.
--
-- Self-cleaning on the happy path: the answer route deletes its row on read.
-- A missing_info call that times out, or whose nudge never sent, leaves an
-- orphaned row behind (nobody ever calls the answer route for that
-- correlationId) — no TTL/cron sweep exists for that yet, the same deferred-
-- scheduler gap as this app's other cron-shaped TODOs. Rows are tiny and
-- created only on missing_info dispatch, so this is a known, accepted gap,
-- not a real growth concern.
--
-- Admin-client only (both writers/readers use createAdminClient) — no
-- anon-facing access, so no RLS policy needed, same posture as
-- health_check_state/reminders.
create table if not exists missing_info_trace_anchors (
  correlation_id text primary key,
  trace_id text not null,
  span_id text not null,
  created_at timestamptz not null default now()
);
