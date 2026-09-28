import { describe, expect, it } from "vitest";
import {
  assertUniqueProductSlugs,
  formatPrice,
  type Product,
  type ProductImage,
  primaryImage,
  toProduct,
} from "../schema";

const validImage: ProductImage = {
  src: "/shop/sample-01.webp",
  alt: "A folded linen throw",
  width: 800,
  height: 800,
};

const validProduct: Product = {
  slug: "linen-throw",
  brand: "Sample Brand",
  name: "Linen Throw",
  price: { amount: 1200, currency: "EUR" },
  description: "A light throw for cool evenings on the terrace.",
  details: "Washed linen, 130 x 170 cm.",
  images: [validImage],
  createdAt: "2026-05-03",
};

describe("toProduct", () => {
  it("parses a fully valid product", () => {
    expect(toProduct(validProduct)).toEqual(validProduct);
  });

  it("throws when the price amount is not an integer", () => {
    const input = { ...validProduct, price: { amount: 12.5, currency: "EUR" } };

    expect(() => toProduct(input)).toThrow(/integer number of minor units/);
  });

  it("throws when the currency is not EUR", () => {
    const input = { ...validProduct, price: { amount: 1200, currency: "USD" } };

    expect(() => toProduct(input)).toThrow();
  });

  it.each(["/terrace.webp", "https://example.com/a.webp"])(
    "throws when the image src %s is not under /shop/",
    (src) => {
      const input = { ...validProduct, images: [{ ...validImage, src }] };

      expect(() => toProduct(input)).toThrow(/under \/shop\//);
    },
  );

  it("throws when there are no images", () => {
    expect(() => toProduct({ ...validProduct, images: [] })).toThrow(/at least one image/);
  });

  it("throws when there are more than eight images", () => {
    const images = Array.from({ length: 9 }, () => validImage);

    expect(() => toProduct({ ...validProduct, images })).toThrow(/at most eight images/);
  });

  it.each([1, 8])("accepts %i images", (count) => {
    const images = Array.from({ length: count }, () => validImage);

    expect(toProduct({ ...validProduct, images }).images).toHaveLength(count);
  });

  it("throws when any one of several images is not under /shop/", () => {
    const images = [validImage, { ...validImage, src: "/terrace.webp" }, validImage];

    expect(() => toProduct({ ...validProduct, images })).toThrow(/under \/shop\//);
  });

  it("throws for the old single `image` key without `images`", () => {
    expect(() => toProduct({ ...validProduct, images: undefined, image: validImage })).toThrow();
  });

  it.each(["Bad_Slug", "-lead", "a--b", "trail-"])("throws when the slug is %s", (slug) => {
    expect(() => toProduct({ ...validProduct, slug })).toThrow(/kebab-case/);
  });

  it("throws when the description is over 240 characters", () => {
    expect(() => toProduct({ ...validProduct, description: "a".repeat(241) })).toThrow(
      /description is too long/,
    );
  });

  it("throws when createdAt is missing", () => {
    expect(() => toProduct({ ...validProduct, createdAt: undefined })).toThrow();
  });

  it.each(["2026-9-1", "2026-09-01T00:00:00Z", "01-09-2026", "2026-02-30"])(
    "throws when createdAt is %s",
    (createdAt) => {
      expect(() => toProduct({ ...validProduct, createdAt })).toThrow(/calendar day/);
    },
  );

  it("accepts a leap day as createdAt", () => {
    expect(toProduct({ ...validProduct, createdAt: "2024-02-29" }).createdAt).toBe("2024-02-29");
  });

  it("throws when input is not an object at all", () => {
    expect(() => toProduct(undefined)).toThrow();
  });
});

describe("assertUniqueProductSlugs", () => {
  it("accepts a list of distinct slugs", () => {
    const products = [validProduct, { ...validProduct, slug: "other" }];

    expect(() => assertUniqueProductSlugs(products)).not.toThrow();
  });

  it("throws naming the duplicated slug", () => {
    expect(() => assertUniqueProductSlugs([validProduct, validProduct])).toThrow(/linen-throw/);
  });
});

describe("primaryImage", () => {
  it("returns the first image", () => {
    const images = [validImage, { ...validImage, alt: "Side" }, { ...validImage, alt: "Back" }];

    expect(primaryImage({ images })).toBe(images[0]);
  });
});

describe("formatPrice", () => {
  it.each([
    [1200, "€12.00"],
    [4550, "€45.50"],
    [0, "€0.00"],
  ])("formats %i minor units as %s", (amount, expected) => {
    expect(formatPrice({ amount, currency: "EUR" })).toBe(expected);
  });
});
