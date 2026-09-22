-- public.documents is the guest-facing knowledge base that
-- apps/guest-communication-agent/src/agent/tools/property-question.ts reads
-- through the anon client and the match_documents RPC. RLS is enabled with a
-- select-to-anon policy ("Allow anonymous read access",
-- 20260720150001_create_documents_pgvector.sql), but a policy only filters
-- rows; the role still needs a table privilege, and in the hosted project
-- anon has none on public.documents. Every production
-- answer_property_question lookup since 2026-08-04 has failed with 42501
-- "permission denied for table documents" (hint: GRANT SELECT ON
-- public.documents TO anon). Local Supabase grants anon table privileges by
-- default, which is why dev worked. match_documents is a plain
-- SECURITY INVOKER plpgsql function, so it reads documents as anon.
--
-- Table-scoped on purpose, least privilege: select on this one table and
-- execute on this one function, no default privileges for anon, no other
-- tables. The existing RLS policy already covers anon and is not duplicated.
grant usage on schema public to anon;
grant select on table public.documents to anon;
grant execute on function public.match_documents(extensions.vector, integer, double precision, jsonb) to anon;
