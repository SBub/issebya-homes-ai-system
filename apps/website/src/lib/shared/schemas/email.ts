import { z } from "zod";

// Trimmed and lowercased before the check, so the stored value satisfies the
// `email = lower(btrim(email))` constraints on the shop tables.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Please enter a valid email address")
  .pipe(z.email("Please enter a valid email address"));
