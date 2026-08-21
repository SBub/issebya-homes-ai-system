-- Drop outreach_history, processed_sessions, admin_logs.
--
-- All three were written and read exclusively by issebya-homes-admin-mcp
-- (supabase/functions/issebya-homes-admin-mcp/), which has been removed
-- from the monorepo:
--   - outreach_history: outreach drafts/approvals/posts, managed by the
--     admin-mcp outreach tools.
--   - processed_sessions: gap-detection deduplication, written by the
--     admin-mcp gap-detection tool (the same one that read chat_logs,
--     dropped in 20260718000000_drop_chat_logs.sql, and wrote
--     knowledge_gap_topics, dropped in
--     20260718000001_drop_knowledge_gap_topics.sql).
--   - admin_logs: admin MCP tool call audit trail, written by admin-mcp's
--     logging middleware.
--
-- Re-verified zero live consumers across apps/, supabase/functions/, and
-- packages/ before writing this migration — remaining references are only
-- migrations, docs, and pgTAP tests.
--
-- channels and reference_guides are intentionally left untouched — still
-- manually maintained via supabase/seed.sql per supabase/CLAUDE.md.
drop table if exists public.outreach_history;
drop table if exists public.processed_sessions;
drop table if exists public.admin_logs;
