import { describe, expect, it } from "vitest";
import { allProducts } from "../products";
import {
  initialWishlistState,
  WISHLIST_ALREADY_UNSUBSCRIBED_COPY,
  WISHLIST_EMAIL_NEWS_LINE,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_UNSUBSCRIBE_INVALID_COPY,
  WISHLIST_UNSUBSCRIBE_LINE,
  WISHLIST_UNSUBSCRIBED_COPY,
  wishlistConfirmationEmailText,
  wishlistContactUpsert,
  wishlistEmailSentCopy,
  wishlistInputFromFormData,
  wishlistSchema,
} from "../wishlist";

const [firstProduct] = allProducts;

const valid = {
  email: "guest@example.com",
  productSlug: firstProduct.slug,
  marketingOptIn: true,
  honeypot: "",
};

function issuePaths(input: unknown) {
  const result = wishlistSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

describe("wishlistSchema", () => {
  it("accepts valid input", () => {
    expect(wishlistSchema.safeParse(valid).success).toBe(true);
  });

  it("trims and lowercases the email so it matches the DB check", () => {
    const result = wishlistSchema.parse({ ...valid, email: "  Guest@Example.COM " });
    expect(result.email).toBe("guest@example.com");
  });

  it("rejects an unticked opt-in with the helper copy", () => {
    expect(issuePaths({ ...valid, marketingOptIn: false })).toEqual([
      { path: "marketingOptIn", message: WISHLIST_OPT_IN_HELPER },
    ]);
  });

  it("rejects a slug the registry does not know", () => {
    expect(issuePaths({ ...valid, productSlug: "does-not-exist" })).toEqual([
      { path: "productSlug", message: "Unknown product" },
    ]);
  });

  it("rejects an invalid email", () => {
    expect(issuePaths({ ...valid, email: "not-an-email" })).toEqual([
      { path: "email", message: "Please enter a valid email address" },
    ]);
  });

  it("rejects a filled honeypot", () => {
    expect(issuePaths({ ...valid, honeypot: "https://spam.example" }).map((i) => i.path)).toEqual([
      "honeypot",
    ]);
  });
});

describe("wishlistInputFromFormData", () => {
  it("maps an absent checkbox to false and 'on' to true", () => {
    const unticked = new FormData();
    expect(wishlistInputFromFormData(unticked).marketingOptIn).toBe(false);

    const ticked = new FormData();
    ticked.set("marketingOptIn", "on");
    expect(wishlistInputFromFormData(ticked).marketingOptIn).toBe(true);
  });

  it("reads the honeypot from the `website` field", () => {
    const fd = new FormData();
    fd.set("website", "filled");
    expect(wishlistInputFromFormData(fd).honeypot).toBe("filled");
  });
});

describe("initialWishlistState", () => {
  it("starts with no item created", () => {
    expect(initialWishlistState.created).toBe(false);
  });
});

describe("wishlistEmailSentCopy", () => {
  it("fills in the guest's email", () => {
    expect(wishlistEmailSentCopy("guest@example.com")).toBe(
      "We've sent a note to guest@example.com.",
    );
  });
});

describe("wishlistConfirmationEmailText", () => {
  const productUrl = `https://issebya.com/shop/${firstProduct.slug}`;
  const unsubscribeUrl = `https://issebya.com/shop/wishlist/unsubscribe?token=${"a".repeat(64)}`;
  const text = wishlistConfirmationEmailText({
    productName: firstProduct.name,
    productUrl,
    unsubscribeUrl,
  });

  it("names the product and links to it on its own line", () => {
    const lines = text.split("\n");
    expect(lines[0]).toContain(firstProduct.name);
    expect(lines).toContain(productUrl);
  });

  it("carries the news line and ends with the unsubscribe link", () => {
    expect(text).toContain(WISHLIST_EMAIL_NEWS_LINE);
    expect(text.split("\n").at(-1)).toBe(`${WISHLIST_UNSUBSCRIBE_LINE} ${unsubscribeUrl}`);
  });

  it("no longer promises a reply-to-stop", () => {
    expect(text).not.toContain("You asked us to");
    expect(text).not.toContain("Reply to this email");
  });

  it("uses no em dash, nor do the unsubscribe pages", () => {
    for (const copy of [
      text,
      WISHLIST_UNSUBSCRIBED_COPY,
      WISHLIST_ALREADY_UNSUBSCRIBED_COPY,
      WISHLIST_UNSUBSCRIBE_INVALID_COPY,
    ]) {
      expect(copy).not.toContain("\u2014");
    }
  });
});

describe("wishlistContactUpsert", () => {
  const now = "2026-09-24T12:00:00.000Z";
  const newToken = () => "b".repeat(64);
  const base = {
    email: "guest@example.com",
    marketing_opt_in: true,
    opted_in_at: now,
    opt_in_copy: WISHLIST_OPT_IN_COPY,
    source: "shop_wishlist",
  };

  it("leaves a new contact's token to the column default", () => {
    expect(wishlistContactUpsert("guest@example.com", null, now, newToken)).toEqual({
      payload: base,
      reconsented: false,
    });
  });

  it("keeps a subscribed contact's token", () => {
    const existing = { unsubscribed_at: null, unsubscribe_token: "a".repeat(64) };
    expect(wishlistContactUpsert("guest@example.com", existing, now, newToken)).toEqual({
      payload: base,
      reconsented: false,
    });
  });

  it("re-subscribes an unsubscribed contact with a fresh token", () => {
    const existing = {
      unsubscribed_at: "2026-09-20T10:00:00.000Z",
      unsubscribe_token: "a".repeat(64),
    };
    expect(wishlistContactUpsert("guest@example.com", existing, now, newToken)).toEqual({
      payload: { ...base, unsubscribed_at: null, unsubscribe_token: "b".repeat(64) },
      reconsented: true,
    });
  });
});
