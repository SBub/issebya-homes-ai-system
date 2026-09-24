import { describe, expect, it } from "vitest";
import { allProducts } from "../products";
import { WISHLIST_OPT_IN_HELPER, wishlistInputFromFormData, wishlistSchema } from "../wishlist";

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
