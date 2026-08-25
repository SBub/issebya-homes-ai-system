/**
 * Single source of truth for room pricing. Read by both the website
 * (booking engine UI) and the guest-communication-agent (getPricing tool).
 * Flat rate, no per-room or seasonal differentiation.
 */

export const ROOM_PRICING = {
  /** Base price per night in euros */
  basePrice: 75,

  /** Currency code for all prices in this config */
  currency: "EUR",

  /** Tourist tax per person per night in euros (charged for first 3 nights only) */
  touristTax: 2,

  /** Number of nights tourist tax applies to */
  touristTaxNights: 3,
} as const;
