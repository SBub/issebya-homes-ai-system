import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allProducts, getProductBySlug } from "../products";

const publicDir = fileURLToPath(new URL("../../../../public", import.meta.url));

describe("product registry", () => {
  it("holds the six sample products", () => {
    expect(allProducts).toHaveLength(6);
  });

  it("has unique slugs", () => {
    const slugs = allProducts.map(({ slug }) => slug);

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // A typo in an image path would otherwise only show up as a broken image
  // in production.
  it.each(allProducts.flatMap(({ images }) => images.map(({ src }) => src)))(
    "%s exists under public/",
    (src) => {
      expect(src.startsWith("/shop/")).toBe(true);
      // The path comes from the checked-in registry, not from user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(existsSync(`${publicDir}${src}`)).toBe(true);
    },
  );

  it.each(allProducts)("$slug has 2 or 3 images", ({ images }) => {
    expect([2, 3]).toContain(images.length);
  });

  it("finds a product by slug", () => {
    const [first] = allProducts;

    expect(getProductBySlug(first.slug)).toBe(first);
  });

  it("returns undefined for an unknown slug", () => {
    expect(getProductBySlug("does-not-exist")).toBeUndefined();
  });
});
