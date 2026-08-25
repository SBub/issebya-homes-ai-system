-- missing_info_trace_anchors (20260814090000_create_missing_info_trace_anchors.sql)
-- and approval_gate_trace_anchors (20260819090000_create_approval_gate_trace_anchors.sql)
-- were created without RLS and without an explicit revoke, unlike every other
-- table in this schema. Both are read/written only via createAdminClient
-- (service role, bypasses RLS) in apps/guest-communication-agent/src/lib/
-- tracing.ts — no anon-facing code path touches them — but on a fresh
-- Supabase project anon/authenticated get default schema-level privileges on
-- public tables unless explicitly revoked. Closing that gap here rather than
-- editing the original (already-applied) migrations.
revoke all on public.missing_info_trace_anchors from anon, authenticated;

revoke all on public.approval_gate_trace_anchors from anon, authenticated;
