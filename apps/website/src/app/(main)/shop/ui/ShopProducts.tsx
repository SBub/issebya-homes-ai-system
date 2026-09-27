import { type DehydratedState, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cacheLife, cacheTag } from "next/cache";
import { getProductsPage } from "@/lib/shop/pages";
import { SHOP_PAGE_SIZE, SHOP_PRODUCTS_QUERY_KEY } from "@/lib/shop/pagination";
import { makeShopQueryClient } from "@/lib/shop/query-client";
import { ProductList } from "./ProductList";

/**
 * Page one, prefetched through `getProductsPage` directly (not HTTP) and
 * dehydrated, inside a `"use cache"` scope.
 *
 * The cache scope is not optional. `QueryClient` and `dehydrate` stamp the
 * state with `Date.now()`, and under Cache Components reading the current
 * time outside a cache scope fails the `/shop` prerender
 * (`next-prerender-current-time`), even after awaiting cached IO first. The
 * Next docs give two other ways out, and both are worse here: `connection()`
 * makes `/shop` dynamic, and a Client Component would mean fetching page one
 * from the browser. Cached, the timestamp is simply the fill time.
 */
async function getFirstPageState(): Promise<DehydratedState> {
  "use cache";
  cacheTag("shop-products");
  cacheLife("days");

  const queryClient = makeShopQueryClient();
  await queryClient.prefetchInfiniteQuery({
    queryKey: SHOP_PRODUCTS_QUERY_KEY,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getProductsPage(pageParam, SHOP_PAGE_SIZE),
  });

  return dehydrate(queryClient);
}

/**
 * Hands page one to `ProductList` in the hydrated query cache, so the client
 * never fetches page one. This whole component is the page's Suspense hole;
 * being cached, it lands in the prerendered shell.
 */
export async function ShopProducts() {
  return (
    <HydrationBoundary state={await getFirstPageState()}>
      <ProductList />
    </HydrationBoundary>
  );
}
