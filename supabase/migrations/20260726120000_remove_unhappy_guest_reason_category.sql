-- Removes `unhappy_guest` from escalations.reason_category's allowed values,
-- leaving exactly three: `missing_info`, `wants_human`, `complaint`. See
-- 20260725100000_add_reason_category_to_escalations.sql for the original
-- four-way constraint and its rationale.
--
-- This is a deliberate product decision, not a bug fix: general guest
-- unhappiness is now handled by the agent's own conversational judgment (a
-- system-prompt concern, in LangSmith's Prompt Hub, outside this repo)
-- rather than being escalated and recorded as a category of its own. A
-- genuine complaint remains a real, recorded escalation category.
--
-- Confirmed via direct query before writing this migration: zero existing
-- escalations rows have reason_category = 'unhappy_guest' (5 rows are
-- missing_info, 1 is null/uncategorized — see that same prior migration's
-- own comment on why null is left alone rather than backfilled) — so this
-- is a clean constraint swap, no data migration/recategorization needed.
alter table public.escalations
  drop constraint escalations_reason_category_check;

alter table public.escalations
  add constraint escalations_reason_category_check
  check (reason_category = any (array['wants_human', 'complaint', 'missing_info']));
