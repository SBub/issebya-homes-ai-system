import { cacheLife, cacheTag } from "next/cache";
import { type ProductsPage, selectPage } from "./pagination";
import { allProducts } from "./products";

/**
 * One page of the shop catalogue, the single server data function behind both
 * the `/shop` prefetch and `GET /api/shop/products`.
 *
 * Profile `cacheLife("days")`: the catalogue rarely changes. There is one
 * server cache entry per `(cursor, limit)` argument pair, and each stores that
 * page's items and the `nextCursor` computed for it. The cursor changing from
 * page to page is data inside entries, not a drifting key.
 *
 * Invalidation is one `revalidateTag("shop-products")` if products ever change
 * at runtime; a deploy rebuilds anyway. An unknown cursor throws
 * `UnknownCursorError`, and a thrown error is not cached.
 */
export async function getProductsPage(cursor: string | null, limit: number): Promise<ProductsPage> {
  "use cache";
  cacheTag("shop-products");
  cacheLife("days");

  return selectPage(allProducts, cursor, limit);
}
