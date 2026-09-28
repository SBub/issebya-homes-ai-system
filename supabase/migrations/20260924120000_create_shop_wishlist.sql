-- Shop wishlist: who wants which product, plus the marketing consent that
-- came with it. Written only by the website's `addToWishlist` Server Action
-- (service role) and read by the owner in Supabase Studio, the same edit
-- surface as the rest of the CRM. No guest ever reads these rows, so there is
-- no view and no access_token: RLS enabled, zero policies, anon +
-- authenticated explicitly revoked, like `bookings`.
--
-- `guest_contacts` is deliberately not used. It is keyed by phone number,
-- which a wishlist visitor never gives, so wishlist consent lives in its own
-- email-keyed table.
--
-- `shop_wishlist_items.product_slug` references the static product registry
-- in apps/website/src/lib/shop/products.ts, not a table, so no foreign key is
-- possible. The Server Action rejects slugs the registry does not know.

create table public.shop_wishlist_contacts (
  email             text         primary key,
  marketing_opt_in  boolean      not null,
  opted_in_at       timestamptz  not null,
  -- The exact consent sentence the visitor agreed to, stored verbatim.
  opt_in_copy       text         not null,
  source            text         not null default 'shop_wishlist',
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  -- A row only exists because the visitor ticked the opt-in box.
  constraint shop_wishlist_contacts_consent_required check (marketing_opt_in = true),
  constraint shop_wishlist_contacts_email_normalised check (email = lower(btrim(email)))
);

alter table public.shop_wishlist_contacts enable row level security;

revoke all on public.shop_wishlist_contacts from anon, authenticated;

create table public.shop_wishlist_items (
  id            uuid         primary key default gen_random_uuid(),
  email         text         not null references public.shop_wishlist_contacts(email) on delete cascade,
  product_slug  text         not null,
  created_at    timestamptz  not null default now(),
  unique (email, product_slug)
);

alter table public.shop_wishlist_items enable row level security;

revoke all on public.shop_wishlist_items from anon, authenticated;

-- "Who wants this piece?" filters by product. The unique index leads with
-- email, so it does not serve that query.
create index shop_wishlist_items_product_slug_idx
  on public.shop_wishlist_items (product_slug);

create or replace function public.update_shop_wishlist_contacts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger shop_wishlist_contacts_updated_at
  before update on public.shop_wishlist_contacts
  for each row execute function public.update_shop_wishlist_contacts_updated_at();
