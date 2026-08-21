/**
 * Pricing constants for the booking engine.
 * All values are hardcoded based on mockup requirements.
 */

export const ROOM_PRICING = {
  /** Base price per night in euros */
  basePrice: 75,

  /** Tourist tax per person per night in euros (charged for first 3 nights only) */
  touristTax: 2,

  /** Number of nights tourist tax applies to */
  touristTaxNights: 3,
} as const;
