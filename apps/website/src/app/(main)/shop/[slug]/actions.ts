"use server";

import { addBreadcrumb, captureException, startSpan } from "@sentry/nextjs";
import {
  WISHLIST_ERROR_COPY,
  type WishlistFormState,
  wishlistContactUpsert,
  wishlistInputFromFormData,
  wishlistSchema,
} from "@/lib/shop/wishlist";
import { sendWishlistConfirmationEmail } from "@/lib/resend";
import { getProductBySlug } from "@/lib/shop/products";
import { newUnsubscribeToken } from "@/lib/shop/unsubscribe";
import { createAdminClient } from "@/lib/shared/supabase";
import { formatZodErrors } from "@/lib/shared/validation";

// Postgres unique_violation, same convention as guest-contacts.ts.
const UNIQUE_VIOLATION = "23505";

export async function addToWishlist(
  prevState: WishlistFormState,
  formData: FormData,
): Promise<WishlistFormState> {
  const attempt = prevState.attempt + 1;
  const raw = wishlistInputFromFormData(formData);
  const email = raw.email.trim();

  const parsed = wishlistSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);

    // Checked before any other field, and answered with the success shape and
    // no DB call, so a bot never learns which field gave it away.
    if (issues.some(({ field }) => field === "honeypot")) {
      addBreadcrumb({ category: "shop", message: "Wishlist honeypot tripped", level: "info" });
      return { attempt, ok: true, errors: {}, generalError: "", email, created: false };
    }

    const errors: WishlistFormState["errors"] = {};
    for (const { field, message } of issues) {
      if (field === "email" || field === "marketingOptIn" || field === "productSlug") {
        errors[field] ??= message;
      }
    }
    return { attempt, ok: false, errors, generalError: "", email, created: false };
  }

  const { productSlug } = parsed.data;
  const failure: WishlistFormState = {
    attempt,
    ok: false,
    errors: {},
    generalError: WISHLIST_ERROR_COPY,
    email,
    created: false,
  };

  // Only the slug goes into Sentry, never the email.
  return startSpan(
    {
      name: "shop.wishlist.add",
      op: "http.server",
      attributes: { "http.route": "shop.addToWishlist", "shop.productSlug": productSlug },
    },
    async () => {
      const supabase = createAdminClient();

      // Read first: an unsubscribed contact consenting again needs its
      // `unsubscribed_at` cleared and its unsubscribe token rotated.
      const { data: existing, error: lookupError } = await supabase
        .from("shop_wishlist_contacts")
        .select("unsubscribed_at, unsubscribe_token")
        .eq("email", parsed.data.email)
        .maybeSingle();

      if (lookupError) {
        captureException(lookupError, {
          tags: { "db.operation": "shop_wishlist_contacts_select" },
        });
        return failure;
      }

      const { payload, reconsented } = wishlistContactUpsert(
        parsed.data.email,
        existing,
        new Date().toISOString(),
        newUnsubscribeToken,
      );

      // Consent first: the item row references the contact row, and a wish
      // must never be stored without the opt-in that came with it. A repeat
      // visit refreshes the consent record to the latest affirmative opt-in.
      // The token comes back so the email carries whichever one is now stored.
      const { data: contact, error: contactError } = await supabase
        .from("shop_wishlist_contacts")
        .upsert(payload, { onConflict: "email" })
        .select("marketing_opt_in, unsubscribe_token")
        .single();

      if (contactError) {
        captureException(contactError, {
          tags: { "db.operation": "shop_wishlist_contacts_upsert" },
        });
        return failure;
      }

      const { error: itemError } = await supabase
        .from("shop_wishlist_items")
        .insert({ email: parsed.data.email, product_slug: productSlug });

      // Already wished for: the row we want exists, so this is a success.
      if (itemError && itemError.code !== UNIQUE_VIOLATION) {
        captureException(itemError, { tags: { "db.operation": "shop_wishlist_items_insert" } });
        return failure;
      }

      // No error means a new row; a unique violation means already wished.
      const created = itemError === null;

      // A new wish, or a renewed consent, is confirmed by email, so repeat
      // clicks never resend. A failed send is reported but never fails the
      // save. The token is never logged or tagged.
      if (contact.marketing_opt_in && (created || reconsented)) {
        try {
          // Always defined: the schema already checked the slug.
          const product = getProductBySlug(productSlug);
          if (!product) throw new Error(`Unknown product ${productSlug}`);
          await sendWishlistConfirmationEmail({
            email: parsed.data.email,
            productName: product.name,
            productSlug,
            unsubscribeToken: contact.unsubscribe_token,
          });
        } catch (error) {
          console.error("Wishlist confirmation email failed", error);
          captureException(error, { tags: { "email.type": "wishlist_confirmation" } });
        }
      }

      return { attempt, ok: true, errors: {}, generalError: "", email, created };
    },
  );
}
