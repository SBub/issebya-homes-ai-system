-- Shop wishlist: a real unsubscribe. A contact is now in one of two consent
-- states, enforced by `shop_wishlist_contacts_consent_state`:
--
--   subscribed:   marketing_opt_in = true,  unsubscribed_at is null
--   unsubscribed: marketing_opt_in = false, unsubscribed_at is not null
--
-- Unsubscribing only flips the contact to the second state. It never deletes
-- the contact or any of their `shop_wishlist_items` rows, so the owner keeps a
-- truthful record of who opted out and when.
--
-- `unsubscribe_token` is the one public accessor to this table, superseding
-- the "no access_token" note in 20260924120000_create_shop_wishlist.sql. It
-- travels only in the confirmation email's link and is looked up server-side,
-- with the service role, by the website's /shop/wishlist/unsubscribe page.
-- RLS stays enabled with zero policies and the anon + authenticated revoke
-- stays: no guest ever reads these rows directly.
--
-- The website's `addToWishlist` rotates the token when an unsubscribed
-- contact consents again, so a link in an old email can never unsubscribe a
-- renewed consent. `gen_random_bytes` is volatile, so each existing row gets
-- its own token when this column is added.

alter table public.shop_wishlist_contacts
  add column unsubscribe_token text not null unique
    default encode(extensions.gen_random_bytes(32), 'hex'),
  add column unsubscribed_at timestamptz null;

alter table public.shop_wishlist_contacts
  drop constraint shop_wishlist_contacts_consent_required,
  add constraint shop_wishlist_contacts_consent_state check (
    (marketing_opt_in and unsubscribed_at is null)
    or (not marketing_opt_in and unsubscribed_at is not null)
  );
