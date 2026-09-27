import { z } from "zod";
import { calendarDaySchema, type Product } from "./schema";

/**
 * Sorted keyset pagination over the shop registry.
 *
 * This module imports only `zod` and `schema.ts`, so it runs in the vitest
 * node pool and is safe to import from a Client Component. It must not import
 * `products.ts` or `next/cache`.
 */

/** The one page size: server prefetch, client query and URL, skeleton count. */
export const SHOP_PAGE_SIZE = 6;

export const SHOP_SORTS = ["newest", "oldest"] as const;
export const shopSortSchema = z.enum(SHOP_SORTS);
export type ShopSort = z.infer<typeof shopSortSchema>;
export const DEFAULT_SHOP_SORT: ShopSort = "newest";

/**
 * The query key for one sort of the grid, shared by the server prefetch and
 * `ProductList`. The sort is in the key, so a new sort is a new query that
 * starts at its own page one.
 */
export function shopProductsQueryKey(sort: ShopSort) {
  return ["shop", "products", SHOP_PAGE_SIZE, sort] as const;
}

export type ProductsPage = { items: Product[]; nextCursor: string | null };

/** A cursor that does not decode to a valid bookmark. */
export class UnknownCursorError extends Error {
  constructor() {
    super("Unknown cursor");
    this.name = "UnknownCursorError";
  }
}

/** A well-formed cursor handed out for a different sort than the request's. */
export class CursorSortMismatchError extends Error {
  constructor() {
    super("Cursor is for a different sort");
    this.name = "CursorSortMismatchError";
  }
}

type SortKey = Pick<Product, "createdAt" | "slug">;

// Plain code-point comparison, not `localeCompare`: slugs are `[a-z0-9-]`, so
// the two agree today, and code-point order cannot drift with the runtime's
// ICU data. `yyyy-MM-dd` days compare the same way, and being zero-padded,
// that order is chronological.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `newest`: `createdAt` descending, then `slug` ascending. `oldest` is the
 * exact negation, so "Oldest first" is literally "Newest first" reversed.
 * Slug is the tie-breaker because it is unique (`assertUniqueProductSlugs`),
 * which makes this a total order: without it, products sharing a day could
 * swap between two requests and be duplicated or skipped across pages.
 */
function compareProducts(a: SortKey, b: SortKey, sort: ShopSort): number {
  const newest = compareStrings(b.createdAt, a.createdAt) || compareStrings(a.slug, b.slug);
  return sort === "newest" ? newest : -newest;
}

/** A sorted copy of `products`; the input is never mutated. */
export function sortProducts(products: readonly Product[], sort: ShopSort): Product[] {
  return [...products].sort((a, b) => compareProducts(a, b, sort));
}

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

const cursorBookmarkSchema = z.object({
  sort: shopSortSchema,
  createdAt: calendarDaySchema,
  slug: z.string().min(1),
});

/** The last item a page showed, in the order it was shown. */
type CursorBookmark = z.infer<typeof cursorBookmarkSchema>;

/** An opaque cursor: `base64url(JSON.stringify({ sort, createdAt, slug }))`. */
export function encodeCursor(bookmark: CursorBookmark): string {
  return toBase64Url(JSON.stringify(bookmark));
}

/**
 * The bookmark a cursor carries. Throws `UnknownCursorError` on garbage and
 * `CursorSortMismatchError` when it was handed out for another sort.
 *
 * The route calls this before the cached `getProductsPage`: an error thrown
 * inside a `"use cache"` scope loses its class on the way out, so the route
 * could not tell a bad cursor (400) from a real failure (500).
 */
export function decodeCursor(cursor: string, sort: ShopSort): CursorBookmark {
  let json: unknown;
  try {
    json = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw new UnknownCursorError();
  }

  const parsed = cursorBookmarkSchema.safeParse(json);
  if (!parsed.success) throw new UnknownCursorError();
  if (parsed.data.sort !== sort) throw new CursorSortMismatchError();
  return parsed.data;
}

/**
 * The only code that sorts and slices the registry. Keyset by
 * `(createdAt, slug)` in `sort` order, never an offset: a page is the items
 * that compare strictly after the bookmark tuple. The bookmarked product does
 * not have to exist any more, so an item inserted before the bookmark, or the
 * bookmarked item being removed, neither duplicates nor skips anything.
 *
 * `nextCursor` is null when this page reaches the end, so an exact multiple of
 * `limit` never hands out a cursor to an empty trailing page.
 */
export function selectPage(
  products: readonly Product[],
  cursor: string | null,
  limit: number,
  sort: ShopSort,
): ProductsPage {
  const sorted = sortProducts(products, sort);

  let start = 0;
  if (cursor !== null) {
    const bookmark = decodeCursor(cursor, sort);
    const index = sorted.findIndex((product) => compareProducts(product, bookmark, sort) > 0);
    start = index === -1 ? sorted.length : index;
  }

  const items = sorted.slice(start, start + limit);
  const last = items.at(-1);
  const nextCursor =
    last && start + limit < sorted.length
      ? encodeCursor({ sort, createdAt: last.createdAt, slug: last.slug })
      : null;

  return { items, nextCursor };
}
