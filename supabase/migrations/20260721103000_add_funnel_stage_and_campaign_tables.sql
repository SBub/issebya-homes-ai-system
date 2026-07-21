-- Phase 1 of campaign-conversion-tracking (silence-detection follow-ups and
-- Orch-A analytics are later phases, not built here): adds guest
-- funnel-stage tracking columns to guest_contacts, and lays down — but does
-- NOT wire up, no application code reads/writes either table yet — the
-- campaigns/promo_codes schema a later phase will build on.
--
-- funnel_stage models how far along a guest is toward booking:
--   new -> informed -> link_sent -> booked
-- Stages only ever move forward. The only writer is CRM's new
-- POST /api/guest-contacts/touch route
-- (apps/crm/src/app/api/guest-contacts/touch/route.ts), which compares a
-- caller-supplied stageHint's rank against the row's current funnel_stage
-- and updates only on a strict increase — e.g. a guest already at
-- link_sent who asks another pricing question stays at link_sent, it never
-- falls back to informed.

alter table public.guest_contacts
  add column funnel_stage text not null default 'new'
    check (funnel_stage in ('new', 'informed', 'link_sent', 'booked'));

alter table public.guest_contacts
  add column last_interaction_at timestamptz;

alter table public.guest_contacts
  add column link_sent_at timestamptz;

alter table public.guest_contacts
  add column stage_updated_at timestamptz;

-- campaigns: one row per outbound campaign (a seasonal nudge blast, a
-- stalled-link-sent follow-up, a social code-word giveaway, or a one-off
-- manual send). Schema only in this phase — nothing reads/writes this table
-- yet.
create table public.campaigns (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  kind       text        not null
    check (kind in ('seasonal_nudge', 'stalled_link_nudge', 'social_code_word', 'manual')),
  created_at timestamptz not null default now()
);

-- server-side only: no anon or authenticated user access, matching every
-- other GCA/CRM-owned table in this schema (see
-- 20260720150002_create_guest_contacts_reconstructed.sql for the same
-- incantation on guest_contacts).
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;

-- promo_codes: individual codes issued under a campaign. guest_contact_id is
-- nullable because a social code-word campaign issues codes before any guest
-- is attached — the code exists first and gets claimed by a guest later.
-- Schema only in this phase — nothing reads/writes this table yet.
create table public.promo_codes (
  id               uuid        primary key default gen_random_uuid(),
  campaign_id      uuid        not null references public.campaigns(id),
  guest_contact_id uuid        references public.guest_contacts(id),
  code             text        not null unique,
  status           text        not null default 'issued'
    check (status in ('issued', 'sent', 'redeemed', 'expired')),
  issued_at        timestamptz not null default now(),
  sent_at          timestamptz,
  redeemed_at      timestamptz
);

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;
