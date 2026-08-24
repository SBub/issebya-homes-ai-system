-- Cleanup pass: drop every remaining table in this local DB that isn't
-- owned by apps/website.
--
-- Audited against apps/website/src and the rest of the monorepo (grep,
-- zero hits) — after this migration, public.bookings (table) and
-- public.booking_availability (view) are the only objects apps/website
-- reads or writes. Everything below is either owned by an app that lives
-- elsewhere, an admin-mcp leftover, or has no owner anywhere in the
-- current codebase.
--
-- (a) apps/guest-communication-agent, apps/crm, and apps/social-media
-- owned tables that leaked into this local DB. All three apps have since
-- been extracted out of this monorepo (see PR #12,
-- chore/extract-crm-finance-social-media — apps/crm and apps/social-media
-- are now empty shells with no src/) and run against their own Supabase
-- project in production. These rows in the local website DB are stray
-- copies with no reader/writer in this repo:
--   - documents: GCA's RAG knowledge base (read by
--     apps/guest-communication-agent's search-property.ts), NOT the
--     admin-mcp-era documents table apps/website used to serve.
--   - guest_contacts, guest_memory, whatsapp_conversations,
--     whatsapp_messages, escalations, booking_link_requests: GCA
--     conversation/memory/escalation state.
--   - campaigns, promo_codes, crm_messages, crm_message_edits: CRM outreach
--     tables (already called out as CRM-owned and left alone in
--     20260719000000_drop_finance_bookings.sql; now dropping them for
--     real since CRM no longer lives in this repo).
--   - asset_gaps, asset_ingestion_errors, assets,
--     content_availability_sequences, content_calendar, pipeline_run_logs,
--     reference_reels: social-media content pipeline tables.
--
-- Dropping promo_codes and campaigns with cascade removes the
-- bookings.promo_code_id / bookings.acquisition_channel foreign keys along
-- with them — bookings itself is untouched, it just loses those two FK
-- constraints (the columns stay, unenforced).
drop table if exists public.booking_link_requests cascade;
drop table if exists public.escalations cascade;
drop table if exists public.whatsapp_messages cascade;
drop table if exists public.whatsapp_conversations cascade;
drop table if exists public.crm_message_edits cascade;
drop table if exists public.crm_messages cascade;
drop table if exists public.promo_codes cascade;
drop table if exists public.campaigns cascade;
drop table if exists public.guest_memory cascade;
drop table if exists public.guest_contacts cascade;
drop table if exists public.documents cascade;
drop table if exists public.asset_gaps cascade;
drop table if exists public.asset_ingestion_errors cascade;
drop table if exists public.assets cascade;
drop table if exists public.pipeline_run_logs cascade;
drop table if exists public.content_calendar cascade;
drop table if exists public.content_availability_sequences cascade;
drop table if exists public.reference_reels cascade;

-- (b) admin-mcp leftovers. issebya-homes-admin-mcp (the edge function that
-- read/wrote these) has been removed from the repo
-- (20260718000003_drop_orphaned_admin_mcp_tables.sql dropped its other
-- tables already). channels and reference_guides were the last two —
-- manually maintained via supabase/seed.sql per supabase/CLAUDE.md, but
-- with the tool that consumed them gone, nothing reads them anymore.
drop table if exists public.channels cascade;
drop table if exists public.reference_guides cascade;

-- (c) chat_logs, knowledge_gap_topics, outreach_history,
-- processed_sessions, admin_logs, and finance_bookings are NOT repeated
-- here — dedicated drop migrations for them already exist in this
-- directory (20260718000000, 20260718000001, 20260718000003,
-- 20260719000000) and simply hadn't been applied to this local DB yet.
-- Running `supabase migration up` applies this migration together with
-- those pending ones, in timestamp order, so they all land in the same
-- pass.

-- (d) fully orphaned — zero references anywhere in the monorepo (grep
-- across apps/ and this repo's supabase/functions/ and migrations/ turned
-- up nothing but the migration that created them,
-- 20260630000001_cleaning_messages.sql /
-- 20260630000002_cleaning_memory.sql). Looks like scaffolding for a
-- cleaning-crew WhatsApp bot (Keila) that was never wired up to any app.
drop table if exists public.message_edits cascade;
drop table if exists public.cleaning_messages cascade;
drop table if exists public.cleaning_memory cascade;
