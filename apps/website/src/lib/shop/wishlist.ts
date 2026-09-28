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

// The email's last line. The builder appends the guest's unsubscribe link.
export const WISHLIST_UNSUBSCRIBE_LINE =
  "If you'd rather not receive these emails, unsubscribe here:";

export const WISHLIST_UNSUBSCRIBED_COPY =
  "You're unsubscribed. We won't email you about the wishlist any more.";

export const WISHLIST_ALREADY_UNSUBSCRIBED_COPY = "You're already unsubscribed.";

export const WISHLIST_UNSUBSCRIBE_INVALID_COPY = "This link isn't valid.";

// The trigger's visible text, which is also its accessible name.
// The dialog's submit button shares the "Save to wishlist" name, so tests must
// scope it to the dialog.
export const WISHLIST_SAVE_LABEL = "Save to wishlist";

export const WISHLIST_SAVED_LABEL = "Saved to wishlist";

// The guest's confirmation email body. The URLs are passed in rather than
// built here so this module stays free of site config.
export function wishlistConfirmationEmailText({
  productName,
  productUrl,
  unsubscribeUrl,
}: {
  productName: string;
  productUrl: string;
  unsubscribeUrl: string;
}): string {
  return [
    `${productName} is on your wishlist.`,
    productUrl,
    "",
    WISHLIST_EMAIL_NEWS_LINE,
    "",
    `${WISHLIST_UNSUBSCRIBE_LINE} ${unsubscribeUrl}`,
  ].join("\n");
}

type WishlistContactRow = { unsubscribed_at: string | null; unsubscribe_token: string };

/**
 * The `shop_wishlist_contacts` upsert payload for a submit, given the row the
 * email already has (if any). A subscribed contact keeps its token, so links
 * in emails it already has keep working. An unsubscribed contact consenting
 * again is flipped back to subscribed with a fresh token, so a link in an old
 * email can never unsubscribe the renewed consent. A new contact takes the
 * token from the column default.
 */
export function wishlistContactUpsert(
  email: string,
  existing: WishlistContactRow | null,
  now: string,
  newToken: () => string,
): { payload: Record<string, unknown>; reconsented: boolean } {
  const payload: Record<string, unknown> = {
    email,
    marketing_opt_in: true,
    opted_in_at: now,
    opt_in_copy: WISHLIST_OPT_IN_COPY,
    source: "shop_wishlist",
  };

  if (existing?.unsubscribed_at) {
    return {
      payload: { ...payload, unsubscribed_at: null, unsubscribe_token: newToken() },
      reconsented: true,
    };
  }

  return { payload, reconsented: false };
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
