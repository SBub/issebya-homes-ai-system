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

// Where a booking started, when it started inside a blog post: a root-relative
// `/blog/<slug>` path that survives the Stripe round trip so the confirmation
// page (and the cancel URL) can offer the reader a way back.
//
// Shape is all this schema can check. Whether the slug names a real post is a
// registry question, answered by `resolveBlogReturn` in
// src/lib/blog/return-path.ts — the one place both trust boundaries agree on.
//
// The slug rule is split into a flat character class plus a refine rather than
// the obvious `/^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/`, which nests a quantifier
// inside a quantified group — the classic ReDoS shape that
// security/detect-unsafe-regex rejects. Same trade-off, and the same two
// checks, as the post `slug` rule in src/lib/blog/schema.ts: these accept
// exactly the same strings and run in linear time.
export const blogReturnPathSchema = z
  .string()
  .regex(/^\/blog\/[a-z0-9-]+$/, "Return path must be a root-relative blog post path")
  .refine(
    (path) => {
      const slug = path.slice("/blog/".length);
      return !slug.startsWith("-") && !slug.endsWith("-") && !slug.includes("--");
    },
    { message: "Return path must be a root-relative blog post path" },
  );

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
    // `.catch(null)`, deliberately, and the only field in this schema that
    // does not fail loudly. A forged or malformed return target must cost the
    // guest the return link, never the booking: the browser supplies this, so
    // anything that is not a well-shaped blog path degrades to "no return
    // target" and checkout proceeds with today's Stripe URLs.
    returnTo: blogReturnPathSchema.nullable().catch(null),
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
