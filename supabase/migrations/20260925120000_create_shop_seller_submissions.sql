-- Shop seller submissions: an outside seller offering a piece for the shop
-- through `/shop/sell`. Written only by the website's `submitSellerSubmission`
-- Server Action (service role) and read by the owner in Supabase Studio, where
-- she sets `status` and `owner_notes`. No seller ever reads these rows back,
-- so there is no view and no access_token: RLS enabled, zero policies, anon +
-- authenticated explicitly revoked, like `shop_wishlist_contacts`.
--
-- Nothing here touches the static product registry. An accepted piece is
-- added to apps/website/src/lib/shop/products.ts by hand.
--
-- Empty optional text fields are stored as null, never ''. The Server Action
-- does that mapping.

create table public.shop_seller_submissions (
  -- Allocated by the `prepareSellerPhotoUploads` Server Action before any
  -- photo is uploaded, so the photos can live under it. The default only
  -- serves rows inserted by hand in Studio.
  id                  uuid         primary key default gen_random_uuid(),
  seller_name         text         not null check (char_length(seller_name) between 1 and 80),
  seller_email        text         not null check (seller_email = lower(btrim(seller_email))),
  seller_phone        text         check (seller_phone is null or char_length(seller_phone) between 5 and 30),
  title               text         not null check (char_length(title) between 1 and 80),
  maker_or_brand      text         check (maker_or_brand is null or char_length(maker_or_brand) <= 40),
  materials           text         not null check (char_length(materials) between 1 and 200),
  dimensions          text         check (dimensions is null or char_length(dimensions) <= 120),
  condition           text         not null check (condition in ('new', 'like_new', 'used', 'vintage')),
  asking_price_cents  integer      not null check (asking_price_cents >= 0),
  currency            text         not null default 'EUR',
  description         text         not null check (char_length(description) between 20 and 2000),
  -- Object paths inside the `seller-submissions` bucket, each
  -- `<submission id>/<index>.<ext>`. Never prefixed with the bucket name.
  photo_paths         text[]       not null check (array_length(photo_paths, 1) between 1 and 6),
  status              text         not null default 'new' check (status in ('new', 'reviewing', 'accepted', 'rejected')),
  owner_notes         text,
  contact_consent_at  timestamptz  not null,
  source              text         not null default 'shop_sell_form',
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);

alter table public.shop_seller_submissions enable row level security;

revoke all on public.shop_seller_submissions from anon, authenticated;

create or replace function public.update_shop_seller_submissions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger shop_seller_submissions_updated_at
  before update on public.shop_seller_submissions
  for each row execute function public.update_shop_seller_submissions_updated_at();

-- "What's new to review?" is the owner's only query.
create index shop_seller_submissions_status_created_at_idx
  on public.shop_seller_submissions (status, created_at desc);

-- The photos. Private, 5 MB per object, images only: the bucket enforces the
-- hard limits even if a browser lies about a file.
--
-- Object paths are `<submission id>/<index>.<ext>` and must never start with
-- `seller-submissions/` (the bucket name is not part of the path).
--
-- No policies on storage.objects, on purpose. The service role bypasses RLS,
-- and every browser upload goes through a server-minted signed upload URL,
-- which needs no policy. anon and authenticated can neither list nor read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-submissions',
  'seller-submissions',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
);
