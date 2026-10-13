-- Lock-in waitlist: who wants to hear when lock-in dates open, what they
-- would work on and when, plus the marketing consent that came with it.
-- Written only by the website's `joinLockinWaitlist` and `saveSignupReason`
-- Server Actions (service role) and read by the owner in Supabase Studio,
-- which is also where the list is exported as CSV. No visitor ever reads
-- these rows: RLS enabled, zero policies, anon + authenticated explicitly
-- revoked, like `shop_wishlist_contacts`.
--
-- `guest_contacts` is deliberately not used. It is keyed by phone number,
-- which the waitlist form never collects, so the waitlist lives in its own
-- email-keyed table.
--
-- A row is in one of two consent states, enforced by
-- `lockin_waitlist_consent_state`:
--
--   subscribed:   marketing_opt_in = true,  unsubscribed_at is null
--   unsubscribed: marketing_opt_in = false, unsubscribed_at is not null
--
-- Unsubscribing only flips the row to the second state. It never deletes the
-- row, so the owner keeps a truthful record of who opted out and when.
--
-- Two tokens, each with one job:
--   `unsubscribe_token` travels only in the welcome email's link and is looked
--     up server-side by /lockin-waitlist/unsubscribe. Rotated when an
--     unsubscribed visitor consents again, so an old email's link can never
--     unsubscribe the renewed consent.
--   `followup_token` is returned only to the browser that just submitted, as
--     the one key for the thank-you panel's "What made you sign up?" answer.
--     Rotated on every submit and cleared once used, so nobody can write an
--     answer to a record they did not just submit.
--
-- The answer columns store slugs, not labels, so a copy tweak never needs a
-- migration. The allowed values match apps/website/src/lib/lockin-waitlist/copy.ts.

create table public.lockin_waitlist (
  email              text         primary key,
  name               text         null check (name is null or char_length(name) between 1 and 100),
  life_area          text         null check (
    life_area in ('work_business', 'relationships', 'health', 'creative_project', 'other')
  ),
  duration           text         null check (duration in ('weekend', '3_days', '7_days')),
  months             text[]       null check (
    months is null
    or (cardinality(months) > 0
        and months <@ array['november', 'december', 'january', 'later']::text[])
  ),
  signup_reason      text         null check (
    signup_reason is null or char_length(signup_reason) between 1 and 1000
  ),
  marketing_opt_in   boolean      not null,
  opted_in_at        timestamptz  not null,
  -- The exact consent sentence the visitor agreed to, stored verbatim.
  opt_in_copy        text         not null,
  unsubscribe_token  text         not null unique
    default encode(extensions.gen_random_bytes(32), 'hex'),
  unsubscribed_at    timestamptz  null,
  followup_token     text         null unique,
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now(),
  constraint lockin_waitlist_email_normalised check (email = lower(btrim(email))),
  constraint lockin_waitlist_consent_state check (
    (marketing_opt_in and unsubscribed_at is null)
    or (not marketing_opt_in and unsubscribed_at is not null)
  )
);

alter table public.lockin_waitlist enable row level security;

revoke all on public.lockin_waitlist from anon, authenticated;

create or replace function public.update_lockin_waitlist_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger lockin_waitlist_updated_at
  before update on public.lockin_waitlist
  for each row execute function public.update_lockin_waitlist_updated_at();
