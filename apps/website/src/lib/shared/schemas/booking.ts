import { z } from "zod";
import { fromCalendarDay } from "@/lib/date-utils";

const CHECKOUT_ROOM_TYPES = ["room1", "room2"] as const;

// The check-in/check-out days now arrive from the browser as strings (the
// guest's own calendar is the only correct reference for the day they
// clicked), so this is a real trust boundary rather than a formality: the
// server must not re-derive the day, only verify it. The regex pins the shape
// and the refine rejects well-shaped nonsense the regex alone lets through,
// e.g. "2026-02-31" or "2026-13-01".
function calendarDaySchema(label: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} date must be in YYYY-MM-DD format`)
    .refine((day) => !Number.isNaN(fromCalendarDay(day).getTime()), {
      message: `${label} date is not a real calendar date`,
    });
}

export const checkoutSchema = z
  .object({
    roomType: z.enum(CHECKOUT_ROOM_TYPES, {
      message: "Please select a valid room type",
    }),
    checkIn: calendarDaySchema("Check-in"),
    checkOut: calendarDaySchema("Check-out"),
    personCount: z
      .number()
      .int()
      .min(1, "At least 1 person required")
      .max(2, "Maximum 2 persons allowed"),
    email: z.string().email("Invalid email address"),
    guestName: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
    // The checkout form always sends a country-code-select + local-number
    // pair combined into E.164 (see country-codes.ts's combinePhoneNumber),
    // so the leading "+" is guaranteed here, not optional.
    phone: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        "Phone number must be in international format, e.g. +14155552671",
      ),
    whatsappOptIn: z.boolean().default(false),
    source: z.enum(["direct", "gca"]).default("direct"),
  })
  .refine((data) => fromCalendarDay(data.checkOut) > fromCalendarDay(data.checkIn), {
    message: "Check-out date must be after check-in date",
    path: ["checkOut"],
  });

export type CheckoutFormData = z.infer<typeof checkoutSchema>;

export const ROOM_TYPES = ["Room 1", "Room 2", "House"] as const;

export const MAX_GUESTS_BY_ROOM = {
  "Room 1": 2,
  "Room 2": 2,
  House: 4,
} as const;
