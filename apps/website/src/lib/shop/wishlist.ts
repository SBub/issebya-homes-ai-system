/**
 * Copy and validation for the shop wishlist form on `/shop/[slug]`.
 *
 * Imports only `zod` and the product registry, so it runs in the vitest node
 * pool. It lives outside `actions.ts` because a "use server" file may only
 * export async functions, and a schema or a string constant is a value export.
 */
import { z } from "zod";
import { getProductBySlug } from "./products";

// The consent sentence shown next to the checkbox. The Server Action stores
// this server-side constant as `opt_in_copy`, never a value from the form, so
// the recorded wording is always the wording the visitor actually saw.
export const WISHLIST_OPT_IN_COPY =
  "Keep me posted about new pieces and the occasional offer from the house.";

export const WISHLIST_OPT_IN_HELPER =
  "To save this to your wishlist we need your OK to send the odd update. No spam, unsubscribe any time.";

export const WISHLIST_SUCCESS_COPY = "Saved. We'll let you know about it.";

export const WISHLIST_ERROR_COPY = "Sorry, that did not save. Please try again in a moment.";

export const wishlistSchema = z.object({
  // Trimmed and lowercased before the check, so the stored value satisfies the
  // `email = lower(btrim(email))` constraint on `shop_wishlist_contacts`.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Please enter a valid email address")
    .pipe(z.email("Please enter a valid email address")),
  // The slug is the product identity (see products.ts). There is no foreign
  // key to check it against, so the registry is the check.
  productSlug: z
    .string()
    .refine((slug) => getProductBySlug(slug) !== undefined, { message: "Unknown product" }),
  // Consent is a hard gate: only an affirmative tick passes.
  marketingOptIn: z.literal(true, { error: WISHLIST_OPT_IN_HELPER }),
  honeypot: z.string().max(0),
});

// React resets an uncontrolled <form> as soon as an `action` submission starts.
// `email` echoes back only the visitor's own submitted email so the input can
// be re-keyed and re-seeded, the same reason as `BookingFormState.values`.
// Nothing else ever comes back: no rows, and nothing about other visitors.
export type WishlistFormState = {
  attempt: number;
  ok: boolean;
  errors: Partial<Record<"email" | "marketingOptIn" | "productSlug", string>>;
  generalError: string;
  email: string;
};

export const initialWishlistState: WishlistFormState = {
  attempt: 0,
  ok: false,
  errors: {},
  generalError: "",
  email: "",
};

// One mapping from the form's fields to the schema's input, shared by the
// action and its tests. The honeypot input is named `website` in the DOM:
// bots fill it, humans never see it.
export function wishlistInputFromFormData(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    productSlug: String(formData.get("productSlug") ?? ""),
    marketingOptIn: formData.get("marketingOptIn") === "on",
    honeypot: String(formData.get("website") ?? ""),
  };
}
