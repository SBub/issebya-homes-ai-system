/**
 * The shop product registry: the single list `/shop`, `/shop/[slug]` and
 * `sitemap.ts` are all driven from.
 *
 * The list is explicit, not a scan of a directory or a database read, for the
 * same reason as the blog registry (`src/lib/blog/posts.ts`): IO in a module
 * both routes import is exactly what quietly drops a page out of the static
 * shell.
 *
 * Every entry is validated at module scope, so a malformed product throws
 * while this module is being evaluated and fails the build.
 *
 * Slugs are stable identifiers, not just URLs: `public.shop_wishlist_items`
 * stores them in `product_slug` (there is no numeric product id). Renaming a
 * slug orphans every wish recorded against it, so don't rename one casually.
 * If a rename is unavoidable, migrate those rows in the same PR.
 *
 * THESE SIX ENTRIES ARE SAMPLE DATA. Replace them with real products by
 * editing this file and the images in `public/shop/`.
 */
import { assertUniqueProductSlugs, type Product, toProduct } from "./schema";

const SAMPLE_DETAILS =
  "This is a sample product used to show how the shop looks. It will be replaced with a real item from the house.\n\nMaterials, dimensions and care notes for the real product will go here.";

const samples = [
  { word: "One", amount: 1200 },
  { word: "Two", amount: 2400 },
  { word: "Three", amount: 3650 },
  { word: "Four", amount: 4800 },
  { word: "Five", amount: 5500 },
  { word: "Six", amount: 7200 },
];

const products: Product[] = samples.map(({ word, amount }, index) =>
  toProduct({
    slug: `sample-product-${word.toLowerCase()}`,
    brand: "Sample Brand",
    name: `Sample Product ${word}`,
    price: { amount, currency: "EUR" },
    description: "A placeholder product. A short note about the item will appear here.",
    details: SAMPLE_DETAILS,
    image: {
      src: `/shop/sample-0${index + 1}.webp`,
      alt: `Placeholder image for Sample Product ${word}`,
      width: 800,
      height: 800,
    },
  }),
);

assertUniqueProductSlugs(products);

export const allProducts: Product[] = products;

export function getProductBySlug(slug: string): Product | undefined {
  return allProducts.find((product) => product.slug === slug);
}
