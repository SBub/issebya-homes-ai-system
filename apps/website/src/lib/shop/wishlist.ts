/**
 * Copy and validation for the shop wishlist form on `/shop/[slug]`.
 *
 * Imports only `zod`, the shared email schema and the product registry, so it
 * runs in the vitest node pool. It lives outside `actions.ts` because a
 * "use server" file may only export async functions, and a schema or a string
 * constant is a value export.
 */
import { z } from "zod";
import { emailSchema } from "@/lib/shared/schemas/email";
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

export const WISHLIST_DIALOG_HEADING = "Save to your wishlist";

// Shown on the confirmation panel only when this submit created a new wish,
// because only then does the action send the confirmation email.
const WISHLIST_EMAIL_SENT_COPY = "We've sent a note to {email}.";

export function wishlistEmailSentCopy(email: string): string {
  return WISHLIST_EMAIL_SENT_COPY.replace("{email}", email);
}

// An en dash, matching the booking email subjects. Never an em dash.
export const WISHLIST_EMAIL_SUBJECT = "Saved to your wishlist – issebya.homes";

export const WISHLIST_EMAIL_NEWS_LINE = "We'll write to you when there's news about it.";

export const WISHLIST_EMAIL_STOP_LINE = "Reply to this email to stop these.";

// The guest's confirmation email body. The URL is passed in rather than built
// here so this module stays free of site config.
export function wishlistConfirmationEmailText({
  productName,
  productUrl,
}: {
  productName: string;
  productUrl: string;
}): string {
  return [
    `${productName} is on your wishlist.`,
    productUrl,
    "",
    WISHLIST_EMAIL_NEWS_LINE,
    "",
    `You asked us to: "${WISHLIST_OPT_IN_COPY}" ${WISHLIST_EMAIL_STOP_LINE}`,
  ].join("\n");
}

export const wishlistSchema = z.object({
  // Normalised to match the `email = lower(btrim(email))` constraint on
  // `shop_wishlist_contacts`.
  email: emailSchema,
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
  // True only when this submit inserted a new item row. The client shows the
  // "sent a note" line only then, since only then is the email sent.
  created: boolean;
};

export const initialWishlistState: WishlistFormState = {
  attempt: 0,
  ok: false,
  errors: {},
  generalError: "",
  email: "",
  created: false,
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
