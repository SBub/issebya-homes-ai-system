import { z } from "zod";

/**
 * The contract for a shop product.
 *
 * This module imports only `zod`, so it runs in the vitest node pool. It is
 * the only thing standing between a typo in the registry (`products.ts`) and
 * a broken card or page.
 */

const productSchema = z.object({
  // Same ReDoS-safe split as the blog slug: a flat character-class regex plus
  // a refine, instead of a nested quantifier that
  // security/detect-unsafe-regex rejects. Linear time, same accepted strings.
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Product slug must be lowercase kebab-case")
    .refine((slug) => !slug.startsWith("-") && !slug.endsWith("-") && !slug.includes("--"), {
      message: "Product slug must be lowercase kebab-case",
    }),
  brand: z.string().trim().min(1, "Product brand is required").max(40, "Product brand is too long"),
  name: z.string().trim().min(1, "Product name is required").max(80, "Product name is too long"),
  // Integer minor units (cents), never a float: 12.00 EUR is 1200.
  price: z.object({
    amount: z
      .number()
      .int("Price amount must be an integer number of minor units")
      .nonnegative("Price amount must not be negative"),
    currency: z.literal("EUR"),
  }),
  // Card copy, so it is capped to what fits the card.
  description: z
    .string()
    .trim()
    .min(1, "Product description is required")
    .max(240, "Product description is too long"),
  // Page copy, uncapped.
  details: z.string().trim().min(1, "Product details are required"),
  // Local files only: next/image needs explicit dimensions for a string src,
  // and keeping images under /shop/ rules out hotlinked third-party assets.
  image: z.object({
    src: z.string().startsWith("/shop/", "Product image src must be under /shop/"),
    alt: z.string().trim().min(1, "Product image alt text is required"),
    width: z.number().int().positive("Product image width must be a positive integer"),
    height: z.number().int().positive("Product image height must be a positive integer"),
  }),
});

export type Product = z.infer<typeof productSchema>;

/**
 * `parse`, not `safeParse`: this runs at module scope in `products.ts`, so a
 * malformed product throws while the route module is being evaluated and
 * fails the build instead of shipping.
 */
export function toProduct(input: unknown): Product {
  return productSchema.parse(input);
}

/**
 * Two products on one URL is a build-time mistake, not a runtime 404, so this
 * throws and names the offender.
 */
export function assertUniqueProductSlugs(products: Product[]): void {
  const seen = new Set<string>();

  for (const { slug } of products) {
    if (seen.has(slug)) {
      throw new Error(`Duplicate product slug: "${slug}"`);
    }
    seen.add(slug);
  }
}

const eurFormatter = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

/** Minor units to a display price: `{ amount: 1200 }` is `€12.00`. */
export function formatPrice({ amount }: Product["price"]): string {
  return eurFormatter.format(amount / 100);
}
