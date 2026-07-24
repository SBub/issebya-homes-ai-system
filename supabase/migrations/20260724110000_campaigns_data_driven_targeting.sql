-- Shifts campaigns from code-driven to data-driven: today, campaigns.kind is
-- a fixed 4-value enum (seasonal_nudge, stalled_link_nudge, social_code_word,
-- manual) enforced by a check constraint, and each kind's actual behavior —
-- which guests qualify, what the message says — is hardcoded as a separate
-- function/branch in application code (getSeasonalNudgeCandidates,
-- getStalledLinkNudgeCandidates in apps/crm/src/lib/campaigns.ts; a
-- hardcoded Record<CampaignKind, string> in
-- apps/crm/src/lib/campaign-messages.ts). Only seasonal_nudge and
-- stalled_link_nudge were ever actually wired end-to-end;
-- social_code_word/manual were schema-only dead enum values with no code
-- behind them.
--
-- From here on, a campaign's targeting rule, discount/offer, and message are
-- data on the campaign's own row, not a hardcoded code branch — creating a
-- new kind of campaign means inserting a new row, not writing new code. This
-- is what lets two upcoming campaign types fit later without another schema
-- rework, without building them now: (a) a "win-back" campaign offering past
-- guests a percentage discount to return, targeted by their last stay being
-- before a cutoff date (target_stay_before + discount_percent), and (b) a
-- winter "lock-in and focus" 2-week program at a flat predefined price,
-- targeted at every guest who's ever completed a booking (min_total_stays)
-- rather than any WhatsApp-funnel signal — not a percentage discount at all,
-- a fixed-price package offer described in free text (offer_description)
-- rather than modeled as a discount.
--
-- kind's check constraint is dropped entirely — it becomes a plain
-- `text not null` column, a free descriptive label used for display/grouping
-- only, no longer a dispatch key application code branches on. This is also
-- how 'manual' and 'social_code_word' get removed as concepts: they simply
-- cease to be blessed enum values because there's no more enum to bless
-- them.
alter table public.campaigns
  drop constraint campaigns_kind_check;

-- Targeting criteria: all nullable, since a campaign uses whichever apply to
-- its own rule (a null criterion is simply not applied as a filter by
-- apps/crm/src/lib/campaigns.ts's getCampaignCandidates). Only
-- target_funnel_stage and min_idle_days are used by the two kinds seeded
-- below; target_stay_before exists now so the future win-back campaign can
-- use it without another migration, but no row populates it yet.
-- min_total_stays is for a different future campaign — a winter program
-- targeting "everyone who's ever completed a booking" — and filters
-- guest_contacts.total_stays >= min_total_stays. funnel_stage can't express
-- that audience: it tracks the WhatsApp-conversation funnel, only ever
-- advanced by POST /api/guest-contacts/touch, so a guest who exists purely
-- from a CSV-synced finance booking (no WhatsApp contact yet) would still
-- default to funnel_stage='new' despite clearly having stayed —
-- funnel_stage='booked' is not a safe proxy for "has a completed booking."
-- guest_contacts.total_stays (populated by finance-sync regardless of
-- funnel_stage) is the reliable signal instead. Also unpopulated by both
-- rows seeded below.
alter table public.campaigns
  add column target_funnel_stage text,
  add column min_idle_days integer,
  add column target_stay_before date,
  add column min_total_stays integer;

-- Offer: discount_percent stays nullable (many campaigns, including both
-- seeded below, have no discount at all). offer_description is NOT NULL with
-- an empty-string default so it's always safe to interpolate into a message
-- template — it covers non-percentage offers too, like the winter program's
-- flat-price package, which discount_percent alone could never express.
alter table public.campaigns
  add column discount_percent integer,
  add column offer_description text not null default '';

-- Message template: replaces the hardcoded per-kind strings in
-- campaign-messages.ts. Supports simple {{placeholder}} substitution
-- (rendered by renderCampaignMessage) — guest name, promo code, discount
-- percent, offer description today; whatever a future template needs
-- tomorrow. Defaults to '' only so the column can be added without a
-- separate backfill statement; every real campaign row must have a non-empty
-- template to ever actually draft a message.
alter table public.campaigns
  add column message_template text not null default '';

-- Lifecycle: is_recurring distinguishes a permanent/automation campaign
-- (like the two seeded below, evaluated on every cron run) from a one-off
-- blast (created once, triggered on demand via
-- POST /api/campaigns/:id/run, never picked up by the recurring cron).
-- enabled lets a recurring campaign be switched off without deleting its
-- row/history — harmless-but-irrelevant for one-off campaigns, which are
-- triggered by id rather than by an is_recurring+enabled scan.
alter table public.campaigns
  add column is_recurring boolean not null default false,
  add column enabled boolean not null default true;

-- Seed/backfill the two existing recurring campaigns with their current real
-- behavior, so nothing regresses. findOrCreateCampaign
-- (apps/crm/src/lib/campaigns.ts) lazily inserts these two rows (keyed by
-- kind, name only) the first time POST /api/cron/check-stalled-guests ever
-- runs for that kind — a local dev count confirmed both rows already exist
-- here. UPDATE handles that already-seeded case (every environment where the
-- cron has run at least once); the guarded INSERT below covers a genuinely
-- fresh environment (e.g. a from-scratch test database) where it hasn't run
-- yet. Both statements are idempotent and safe to re-run.
update public.campaigns
set target_funnel_stage = 'new',
    min_idle_days = 3,
    is_recurring = true,
    enabled = true,
    message_template = 'Hi! Just checking in — no rush at all. [fill in what''s happening locally this season]. Happy to help with availability or pricing whenever you''re ready!'
where kind = 'seasonal_nudge';

insert into public.campaigns
  (name, kind, target_funnel_stage, min_idle_days, is_recurring, enabled, message_template)
select
  'Seasonal check-in (automated)', 'seasonal_nudge', 'new', 3, true, true,
  'Hi! Just checking in — no rush at all. [fill in what''s happening locally this season]. Happy to help with availability or pricing whenever you''re ready!'
where not exists (select 1 from public.campaigns where kind = 'seasonal_nudge');

update public.campaigns
set target_funnel_stage = 'link_sent',
    min_idle_days = 5,
    is_recurring = true,
    enabled = true,
    message_template = 'Hi! Just following up on the booking link I sent over — still interested in those dates? Happy to answer any questions, or help if anything''s changed.'
where kind = 'stalled_link_nudge';

insert into public.campaigns
  (name, kind, target_funnel_stage, min_idle_days, is_recurring, enabled, message_template)
select
  'Stalled booking-link follow-up (automated)', 'stalled_link_nudge', 'link_sent', 5, true, true,
  'Hi! Just following up on the booking link I sent over — still interested in those dates? Happy to answer any questions, or help if anything''s changed.'
where not exists (select 1 from public.campaigns where kind = 'stalled_link_nudge');

-- Neither template above needs a {{placeholder}} — neither hardcoded message
-- ever referenced a real link, code, or discount value (seasonal_nudge's
-- only dynamic-looking piece, "[fill in what's happening locally this
-- season]", is a literal hand-fill placeholder for the user to edit later,
-- not a renderCampaignMessage substitution token). Both ship as static text,
-- unchanged from campaign-messages.ts's original copy.
