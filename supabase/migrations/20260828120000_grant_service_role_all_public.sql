-- No migration in this repo has ever granted service_role anything —
-- confirmed by grepping every prior migration file. Every working grant
-- (whatsapp_conversations, whatsapp_messages, documents, its sequence) was
-- applied ad-hoc in the Supabase SQL editor and never committed, so any
-- table not covered by that one-off session (e.g. guest_contacts, created
-- 20260720150002, predating that fix) is still running on whatever default
-- privileges a CLI-provisioned hosted project gives a postgres-owned table:
-- none for service_role. Confirmed in production: "permission denied for
-- table guest_contacts" on the website's booking flow.
--
-- This is the same fix applied ad-hoc before, made blanket and permanent:
-- grants on every existing object, plus ALTER DEFAULT PRIVILEGES so every
-- future table/sequence/function this role creates is covered automatically
-- and this class of bug can't recur one table at a time.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
