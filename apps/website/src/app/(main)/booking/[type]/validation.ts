import { z } from "zod";

// Shared between the client form (onBlur validation, uncontrolled inputs —
// see BookingEngineExpanded.tsx) and the server action (actions.ts). Lives in
// its own plain module, not inside actions.ts, because a "use server" file
// may only export async functions — a zod schema is a value export and would
// break the build if it lived there.
export const emailSchema = z.string().email("Please enter a valid email address");
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Please enter your name")
  .max(100, "Name is too long");
// Local-number-only check — the country code is guaranteed by the selector,
// so this just guards against an empty/too-short digit string, not a full
// E.164 shape (that's validated after combining, server-side via
// checkoutSchema's phone regex).
export const localNumberSchema = z
  .string()
  .regex(/^\d{4,14}$/, "Please enter a valid phone number");
