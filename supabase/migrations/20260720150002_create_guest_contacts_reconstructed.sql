-- RECONSTRUCTED, not ported — there is no committed migration for
-- guest_contacts anywhere in issebya-homes-website's git history, on any
-- branch, despite being referenced as real (and depended on) by that repo's
-- own docs (docs/automation/crm-*.md, supabase/CLAUDE.md) and by GCA's own
-- src/lib/db.ts (loadGuestInfo). It's a genuine gap in the source repo, not
-- something findable by searching harder — confirmed via `git log --all
-- --diff-filter=A` for that filename returning zero commits on any branch.
--
-- This table's shape is inferred, not verified against a real schema:
-- columns actually read by the ported code (phone, last_room,
-- last_stay_checkin, total_stays — see src/lib/gca/db.ts's loadGuestInfo)
-- plus two more documented as real in issebya-homes-website's own docs
-- (guest_name, last_stay_checkout, phone UNIQUE — docs/automation/
-- crm-contacts-view.md, crm-strategy.md, crm-testing-guide.md there). No
-- other columns are invented here (e.g. an opt-out/consent flag is implied
-- by those docs for campaign use but never named precisely enough to
-- reconstruct) — deliberately narrower than the real table until its
-- actual schema is pulled from whatever Supabase project backs it, or
-- until CRM/campaign work (a separate, not-yet-scoped effort) defines what
-- it actually needs.
--
-- No writer populates this yet in this repo either — GCA's own
-- loadGuestInfo only reads it. Whoever eventually derives contacts from
-- apps/finance's finance_bookings (see the CRM conversation this was
-- scoped alongside) is the natural future writer.

CREATE TABLE public.guest_contacts (
  phone               text        PRIMARY KEY,
  guest_name          text,
  last_room           text,
  last_stay_checkin   date,
  last_stay_checkout  date,
  total_stays         integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- server-side only: no anon or authenticated user access, matching every
-- other GCA-owned table in this migration set.
ALTER TABLE public.guest_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_contacts FROM anon, authenticated;
