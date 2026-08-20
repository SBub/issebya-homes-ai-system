-- Cross-request trace-anchor handoff for the generic approval-gate flow
-- (apps/guest-communication-agent's src/lib/tracing.ts's
-- recordApprovalGateTraceAnchor/consumeApprovalGateTraceAnchor). Parallel to
-- missing_info_trace_anchors (see
-- 20260814090000_create_missing_info_trace_anchors.sql) but generic over any
-- tool gated by approval-gate.ts's requestApprovalGate (run-turn.ts's
-- APPROVAL_GATES table — send_booking_link today, any future entry
-- tomorrow) — kept as its own separate table, not reused, so the
-- already-verified-working missing_info path stays completely undisturbed.
--
-- No business-logic correlation lives here either — correlationId's real job
-- (tying a later Telegram approve/reject decision back to the specific
-- suspended run-guest-turn Inngest function) still happens with zero DB
-- rows, via the correlationId riding directly in the Telegram button's
-- callback_data (see apps/telegram-router's owner-nudges route). This table
-- exists purely so the owner-nudges approve route (a separate HTTP request,
-- sometimes hours later, possibly a different server instance) can find the
-- real gen_ai.tool.<toolName> span's {traceId, spanId} and nest the
-- approve/reject decision's span underneath it, instead of starting its own
-- disconnected trace root.
--
-- Self-cleaning on the happy path: the approve route deletes its row on
-- read. A gated call that times out, or whose nudge never sent, leaves an
-- orphaned row behind (nobody ever calls the approve route for that
-- correlationId) — no TTL/cron sweep exists for that yet, same accepted gap
-- as missing_info_trace_anchors.
--
-- Admin-client only (both writers/readers use createAdminClient) — no
-- anon-facing access, so no RLS policy needed, same posture as
-- missing_info_trace_anchors/health_check_state/reminders.
create table if not exists approval_gate_trace_anchors (
  correlation_id text primary key,
  trace_id text not null,
  span_id text not null,
  created_at timestamptz not null default now()
);
