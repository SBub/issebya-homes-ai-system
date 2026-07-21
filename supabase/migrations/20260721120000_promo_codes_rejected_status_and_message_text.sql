-- Phase 2 of campaign-conversion-tracking (still schema/backend primitives —
-- the cron that drafts these messages and the Telegram approve/reject flow
-- that will call the new mark-sent/mark-rejected CRM endpoints are a later
-- phase, not built here): refines the promo_codes schema laid down in
-- 20260721103000_add_funnel_stage_and_campaign_tables.sql. Safe to alter
-- freely — that migration's own comments confirm nothing reads/writes this
-- table yet, and a fresh count against local dev data confirmed 0 rows.

-- Add 'rejected' as its own terminal status, distinct from 'expired'.
-- 'expired' means "a decision never came in time" (the Telegram approval
-- request timed out with no owner action) — a silence/timeout outcome.
-- 'rejected' means the owner was asked and explicitly declined to send this
-- promo code. Conflating the two would make it impossible to tell, later,
-- whether a code went unsent because nobody looked at it or because a human
-- deliberately said no — a real difference for both analytics and for
-- deciding whether to re-offer the same guest a similar code later.
alter table public.promo_codes
  drop constraint promo_codes_status_check;

alter table public.promo_codes
  add constraint promo_codes_status_check
    check (status in ('issued', 'sent', 'redeemed', 'expired', 'rejected'));

-- The actual drafted outbound message text. Generated once by the
-- (not-yet-built) cron that issues a promo_codes row and stored here so
-- every downstream consumer — the Telegram approval draft, and later the
-- actual send — reads the exact same text instead of each regenerating or
-- re-guessing it from campaign/guest context.
alter table public.promo_codes
  add column message_text text not null;
