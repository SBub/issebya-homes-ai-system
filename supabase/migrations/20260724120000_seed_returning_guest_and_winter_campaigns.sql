-- Seeds the two future campaigns that
-- 20260724110000_campaigns_data_driven_targeting.sql added the schema for but
-- deliberately left unpopulated: a win-back discount for past guests
-- (target_stay_before + discount_percent) and a winter "Lock-In & Focus"
-- flat-price program (min_total_stays + offer_description). These are
-- definitions only — inserting the row does not draft or send anything to a
-- single guest. Drafting only happens via draftForCampaign
-- (apps/crm/src/lib/campaigns.ts), called either by
-- runCheckStalledGuests (for is_recurring+enabled rows, on the cron) or by
-- POST /api/campaigns/:id/run (any row, on demand by id) — neither is invoked
-- by this migration.
--
-- Both rows are seeded with is_recurring = false: unlike seasonal_nudge and
-- stalled_link_nudge, which are ongoing automations re-evaluated on every
-- cron run for whichever guests currently match, these two are one-off
-- blasts against a fixed snapshot of past guests. Re-running the same
-- criteria on a later cron tick would keep re-matching the same
-- already-contacted guests (a past checkout date and a completed-stay count
-- don't change going forward the way idle-days/funnel-stage do), which is
-- exactly what alreadyNudgedGuestIds's dedup-by-campaign-id guards against
-- for recurring campaigns but is the wrong model here — these are meant to
-- run once, triggered explicitly by id via POST /api/campaigns/:id/run, not
-- picked up automatically by getRecurringEnabledCampaigns. enabled = true is
-- set anyway for consistency with the column's default and because it's
-- harmless for a one-off row (getRecurringEnabledCampaigns filters on
-- is_recurring first, so enabled is never even consulted for these two).
--
-- Actually triggering either campaign (running POST /api/campaigns/:id/run,
-- which would insert promo_codes rows and push drafts to
-- apps/telegram-router) is an explicit separate step for later, not part of
-- this migration.

-- Win-back: past guests whose last stay checked out before summer get a
-- straightforward percentage discount to return. target_stay_before is the
-- new column added (but left null) by the prior migration specifically for
-- this campaign — getCampaignCandidates applies it as
-- lt("last_stay_checkout", campaign.target_stay_before), so '2026-06-01'
-- means "last stay checked out before June 1, 2026". discount_percent is a
-- real percentage (not a flat price like the winter program below), so
-- message_template's {{discount_percent}} substitution has a value to fill
-- in. No target_funnel_stage/min_idle_days — this campaign doesn't care
-- about WhatsApp-funnel state at all, only past-stay recency.
insert into public.campaigns
  (name, kind, target_stay_before, discount_percent, offer_description, message_template, is_recurring, enabled)
values (
  'Win-back: 10% off for past guests before summer',
  'returning_guest_discount',
  '2026-06-01',
  10,
  '10% off your next stay',
  'Hi {{guest_name}}! We loved having you stay with us and wanted to reach out — as a returning guest, we''d like to offer you {{discount_percent}}% off your next booking. Just mention code {{promo_code}} when you get in touch. Hope to welcome you back soon!',
  false,
  true
);

-- Winter "Lock-In & Focus" program: a flat-price 2-week package, open to
-- anyone who's ever completed a booking. min_total_stays = 1 is deliberately
-- not target_funnel_stage-based — see the prior migration's comment and
-- getCampaignCandidates's own doc comment for the full reasoning, but in
-- short: funnel_stage only tracks the WhatsApp-conversation funnel (advanced
-- solely by POST /api/guest-contacts/touch), so a guest who exists purely
-- from a finance-synced booking with no WhatsApp contact yet would still sit
-- at funnel_stage='new' despite clearly having stayed. guest_contacts.
-- total_stays (populated by finance-sync regardless of funnel_stage) is the
-- reliable "has actually stayed here" signal instead, which is exactly what
-- this program wants to target. No discount_percent — this is a fixed-price
-- package, not a percentage off, so the offer is carried entirely in
-- offer_description as free text. The exact price is not yet decided, so
-- offer_description ships with the same kind of hand-fill placeholder
-- seasonal_nudge's message_template already uses for its own
-- not-yet-decided content ("[fill in what's happening locally this
-- season]") — a literal placeholder for a human to edit later, not a
-- renderCampaignMessage {{token}}.
insert into public.campaigns
  (name, kind, min_total_stays, offer_description, message_template, is_recurring, enabled)
values (
  'Winter Lock-In & Focus Program',
  'winter_lockin_program',
  1,
  'a fixed price for the full two weeks — [fill in exact price]',
  'Hi {{guest_name}}! This winter we''re running something new: a 2-week "Lock-In & Focus" program — a dedicated stretch of time to unplug and get deep work done, {{offer_description}}. Since you''ve stayed with us before, we wanted you to be among the first to know. Interested? Just reply and we''ll get you set up. (code: {{promo_code}})',
  false,
  true
);
