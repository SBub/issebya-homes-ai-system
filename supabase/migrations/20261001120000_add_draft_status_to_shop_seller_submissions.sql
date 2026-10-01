-- Shop seller submissions: `/shop/sell` is now a three-step wizard. Step one
-- (details) inserts the row as a `draft` before any photo exists, step two
-- attaches the photos to that draft, and step three flips it to `submitted`,
-- which is the only moment the owner is emailed. The owner's review states
-- stay as they were; `new` is renamed to `submitted` because that is the
-- state the wizard writes, so one column tells the whole story:
--
--   draft      step one done, photos not yet attached. Never shown to the
--              owner, no email was sent.
--   submitted  step three done, the owner has been emailed (was `new`).
--   reviewing, accepted, rejected  set by the owner in Studio, unchanged.
--
-- A draft has no photos yet, so the photo count check only applies once the
-- row is out of `draft`. Every statement here re-runs cleanly: constraints
-- are dropped by name before they are added, and the rename is a no-op the
-- second time.

alter table public.shop_seller_submissions
  drop constraint if exists shop_seller_submissions_status_check;

update public.shop_seller_submissions
  set status = 'submitted'
  where status = 'new';

alter table public.shop_seller_submissions
  alter column status set default 'submitted';

alter table public.shop_seller_submissions
  add constraint shop_seller_submissions_status_check
    check (status in ('draft', 'submitted', 'reviewing', 'accepted', 'rejected'));

alter table public.shop_seller_submissions
  drop constraint if exists shop_seller_submissions_photo_paths_check;

alter table public.shop_seller_submissions
  add constraint shop_seller_submissions_photo_paths_check
    check (
      (status = 'draft' and coalesce(array_length(photo_paths, 1), 0) <= 6)
      or (status <> 'draft' and array_length(photo_paths, 1) between 1 and 6)
    );
