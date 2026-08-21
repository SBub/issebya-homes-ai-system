import { z } from "zod";

const CHECKOUT_ROOM_TYPES = ["room1", "room2"] as const;

export const checkoutSchema = z
  .object({
    roomType: z.enum(CHECKOUT_ROOM_TYPES, {
      message: "Please select a valid room type",
    }),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Check-in date must be in YYYY-MM-DD format"),
    checkOut: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Check-out date must be in YYYY-MM-DD format"),
    personCount: z
      .number()
      .int()
      .min(1, "At least 1 person required")
      .max(2, "Maximum 2 persons allowed"),
    email: z.string().email("Invalid email address"),
  })
  .refine((data) => new Date(data.checkOut) > new Date(data.checkIn), {
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
