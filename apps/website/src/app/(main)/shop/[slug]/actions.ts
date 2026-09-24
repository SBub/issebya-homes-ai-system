"use server";

import { addBreadcrumb, captureException, startSpan } from "@sentry/nextjs";
import {
  WISHLIST_ERROR_COPY,
  WISHLIST_OPT_IN_COPY,
  type WishlistFormState,
  wishlistInputFromFormData,
  wishlistSchema,
} from "@/lib/shop/wishlist";
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
      return { attempt, ok: true, errors: {}, generalError: "", email };
    }

    const errors: WishlistFormState["errors"] = {};
    for (const { field, message } of issues) {
      if (field === "email" || field === "marketingOptIn" || field === "productSlug") {
        errors[field] ??= message;
      }
    }
    return { attempt, ok: false, errors, generalError: "", email };
  }

  const { productSlug } = parsed.data;
  const failure: WishlistFormState = {
    attempt,
    ok: false,
    errors: {},
    generalError: WISHLIST_ERROR_COPY,
    email,
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

      // Consent first: the item row references the contact row, and a wish
      // must never be stored without the opt-in that came with it. A repeat
      // visit refreshes the consent record to the latest affirmative opt-in.
      const { error: contactError } = await supabase.from("shop_wishlist_contacts").upsert(
        {
          email: parsed.data.email,
          marketing_opt_in: true,
          opted_in_at: new Date().toISOString(),
          opt_in_copy: WISHLIST_OPT_IN_COPY,
          source: "shop_wishlist",
        },
        { onConflict: "email" },
      );

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

      return { attempt, ok: true, errors: {}, generalError: "", email };
    },
  );
}
