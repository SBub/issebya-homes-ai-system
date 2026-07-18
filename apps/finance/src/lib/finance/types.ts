import { z } from "zod";

const platformSchema = z.enum(["airbnb", "booking_com"]);
export type Platform = z.infer<typeof platformSchema>;

const roomSchema = z.enum(["room_1", "room_2"]);
export type Room = z.infer<typeof roomSchema>;

/**
 * Mirrors the `finance_bookings` table (supabase/migrations/20260718213027_finance_bookings.sql
 * + 20260718223000_finance_bookings_add_commission_amount.sql). Validated at
 * parse time (see parsers.ts) so a malformed CSV row fails loudly instead of
 * silently writing bad data.
 */
export const financeBookingSchema = z.object({
  booking_id: z.string().min(1),
  platform: platformSchema,
  room: roomSchema,
  guest_name: z.string().min(1),
  checkin_date: z.string(),
  checkout_date: z.string(),
  booked_date: z.string().nullable(),
  nights: z.number().int().nonnegative(),
  guests: z.number().int().nonnegative(),
  gross_room_income: z.number(),
  platform_fee: z.number(),
  net_received: z.number(),
  tourist_tax: z.number(),
  net_after_tourist: z.number(),
  cleaning_cost: z.number(),
  actual_profit: z.number(),
  irs_taxable_base: z.number(),
  status: z.literal("completed"),
  // Booking.com only — the pure commission amount Modelo 30 needs, kept
  // separate from `platform_fee` (which combines commission + payment fee).
  // Null for Airbnb, whose Modelo 30 base is derived from gross_room_income
  // instead. See docs/finance/modelo-30-filing.md.
  commission_amount: z.number().nullable(),
});

export type FinanceBooking = z.infer<typeof financeBookingSchema>;
