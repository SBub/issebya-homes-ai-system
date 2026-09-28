import { cacheLife, cacheTag } from "next/cache";
import { type ProductsPage, type ShopSort, selectPage } from "./pagination";
import { allProducts } from "./products";

/**
 * One page of the shop catalogue, the single server data function behind both
 * the `/shop` prefetch and `GET /api/shop/products`.
 *
 * Profile `cacheLife("days")`: the catalogue rarely changes. There is one
 * server cache entry per `(cursor, limit, sort, q)` argument tuple, and each
 * stores that page's items and the `nextCursor` computed for it. The cursor
 * changing from page to page is data inside entries, not a drifting key.
 *
 * `sort` has to be part of the key because `cursor = null` is a different page
 * one per sort, and `q` for the same reason: each search term has its own page
 * one. (A cursor for one sort or term is rejected for another by the route
 * before it ever reaches here.) The key space is bounded by the 60-character
 * term cap and the cache's LRU.
 *
 * Invalidation is one `revalidateTag("shop-products")` if products ever change
 * at runtime, and it clears both orders; a deploy rebuilds anyway. A bad
 * cursor throws, and a thrown error is not cached.
 */
export async function getProductsPage(
  cursor: string | null,
  limit: number,
  sort: ShopSort,
  q: string,
): Promise<ProductsPage> {
  "use cache";
  cacheTag("shop-products");
  cacheLife("days");

  return selectPage(allProducts, cursor, limit, sort, q);
}
