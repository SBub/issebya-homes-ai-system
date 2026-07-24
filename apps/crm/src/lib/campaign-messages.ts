import type { Campaign, GuestContact } from "./campaigns";

// Matches a {{placeholder}} token literally — no templating library, per
// this repo's simplicity-first default: a plain string-replace pass is
// sufficient for the substitutions any campaign needs today or is expected
// to need soon (guest name, promo code, discount percent, a free-text offer
// description).
const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Renders campaign.message_template for one guest + one issued promo code,
 * substituting whichever {{placeholder}} tokens the template actually
 * contains. Replaces the old hardcoded Record<CampaignKind, string> —
 * message copy now lives on the campaign row
 * (supabase/migrations/20260724110000_campaigns_data_driven_targeting.sql's
 * message_template column) instead of a per-kind code branch here.
 *
 * Supported placeholders:
 *   {{guest_name}}        — guest.guest_name, or '' if unknown
 *   {{promo_code}}         — the code just issued for this guest
 *   {{discount_percent}}   — campaign.discount_percent, or '' if this
 *                            campaign has no percentage discount (both
 *                            kinds seeded today have none)
 *   {{offer_description}} — campaign.offer_description (covers non-percentage
 *                            offers too, like a flat-price package; '' by
 *                            default)
 *
 * Neither of today's two seeded templates (seasonal_nudge,
 * stalled_link_nudge) actually uses any placeholder — both are static text,
 * verbatim from the old hardcoded copy. An unrecognized {{token}} is left
 * untouched rather than silently dropped, so a typo in a future campaign's
 * template is visible in the drafted message rather than disappearing.
 */
export function renderCampaignMessage(
  campaign: Campaign,
  guest: GuestContact,
  promoCode: string,
): string {
  const values: Record<string, string> = {
    guest_name: guest.guest_name ?? "",
    promo_code: promoCode,
    discount_percent: campaign.discount_percent != null ? String(campaign.discount_percent) : "",
    offer_description: campaign.offer_description,
  };

  return campaign.message_template.replace(PLACEHOLDER_PATTERN, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}
