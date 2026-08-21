/**
 * Price calculation utilities for the booking engine.
 */

import { differenceInDays } from "date-fns";
import { ROOM_PRICING } from "./pricing";

/**
 * Calculate the number of nights between two dates.
 */
export function calculateNights(checkIn: Date, checkOut: Date): number {
  return differenceInDays(checkOut, checkIn);
}

/**
 * Calculate the base price (nights × base price per night).
 */
export function calculateBasePrice(nights: number): number {
  return nights * ROOM_PRICING.basePrice;
}

/**
 * Calculate tourist tax.
 * Tourist tax is charged for the first 3 nights only, at 2€ per person per night.
 */
export function calculateTouristTax(nights: number, persons: number): number {
  const taxableNights = Math.min(nights, ROOM_PRICING.touristTaxNights);
  return taxableNights * persons * ROOM_PRICING.touristTax;
}

/**
 * Calculate the total price for a booking.
 * Total = basePrice + touristTax
 */
export function calculateTotalPrice(
  checkIn: Date,
  checkOut: Date,
  persons: number,
): {
  nights: number;
  basePrice: number;
  touristTax: number;
  total: number;
} {
  const nights = calculateNights(checkIn, checkOut);
  const basePrice = calculateBasePrice(nights);
  const touristTax = calculateTouristTax(nights, persons);
  const total = basePrice + touristTax;

  return {
    nights,
    basePrice,
    touristTax,
    total,
  };
}

/**
 * Format a price in euros (e.g., "65€" or "500€").
 */
export function formatPrice(price: number): string {
  return `${price}€`;
}
