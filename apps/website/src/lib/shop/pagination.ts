import type { Product } from "./schema";

/**
 * Keyset pagination over the shop registry.
 *
 * This module imports only the `Product` type, so it runs in the vitest node
 * pool and is safe to import from a Client Component. It must not import
 * `products.ts` or `next/cache`.
 */

/** The one page size: server prefetch, client query and URL, skeleton count. */
export const SHOP_PAGE_SIZE = 6;

export const SHOP_PRODUCTS_QUERY_KEY = ["shop", "products", SHOP_PAGE_SIZE] as const;

export type ProductsPage = { items: Product[]; nextCursor: string | null };

/** A cursor that does not decode, or names a slug no longer in the registry. */
export class UnknownCursorError extends Error {
  constructor() {
    super("Unknown cursor");
    this.name = "UnknownCursorError";
  }
}

const CURSOR_PREFIX = "after:";

// base64url via btoa/atob + TextEncoder/TextDecoder rather than `Buffer`, so
// the codec works in node and in the browser alike.
function toBase64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) =>
    String.fromCharCode(byte),
  ).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** An opaque cursor pointing just after `slug`: `base64url("after:<slug>")`. */
export function encodeCursor(slug: string): string {
  return toBase64Url(`${CURSOR_PREFIX}${slug}`);
}

/** The slug a cursor points after. Throws `UnknownCursorError` on garbage. */
export function decodeCursor(cursor: string): string {
  let text: string;
  try {
    text = fromBase64Url(cursor);
  } catch {
    throw new UnknownCursorError();
  }

  if (!text.startsWith(CURSOR_PREFIX)) throw new UnknownCursorError();
  const slug = text.slice(CURSOR_PREFIX.length);
  if (slug === "") throw new UnknownCursorError();
  return slug;
}

/**
 * Where the page after `cursor` starts: 0 for no cursor, otherwise just after
 * the slug it names. Throws `UnknownCursorError` for garbage or a slug no
 * longer in `products`.
 *
 * The route calls this before the cached `getProductsPage`: an error thrown
 * inside a `"use cache"` scope loses its class on the way out, so the route
 * could not tell a bad cursor (400) from a real failure (500).
 */
export function cursorStart(products: readonly Product[], cursor: string | null): number {
  if (cursor === null) return 0;

  const slug = decodeCursor(cursor);
  const index = products.findIndex((product) => product.slug === slug);
  if (index === -1) throw new UnknownCursorError();
  return index + 1;
}

/**
 * The only code that slices the registry. Keyset by slug, never an offset:
 * an offset shifts items if the list changes between two loads, while a slug
 * either still exists (continue after it) or does not (`UnknownCursorError`).
 *
 * `nextCursor` is null when this page reaches the end, so an exact multiple of
 * `limit` never hands out a cursor to an empty trailing page.
 */
export function selectPage(
  products: readonly Product[],
  cursor: string | null,
  limit: number,
): ProductsPage {
  const start = cursorStart(products, cursor);
  const items = products.slice(start, start + limit);
  const last = items.at(-1);
  const nextCursor = last && start + limit < products.length ? encodeCursor(last.slug) : null;

  return { items, nextCursor };
}
