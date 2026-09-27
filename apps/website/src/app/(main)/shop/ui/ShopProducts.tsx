import { type DehydratedState, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cacheLife, cacheTag } from "next/cache";
import { getProductsPage } from "@/lib/shop/pages";
import {
  DEFAULT_SHOP_SORT,
  SHOP_PAGE_SIZE,
  type ShopSort,
  shopProductsQueryKey,
  shopSortSchema,
} from "@/lib/shop/pagination";
import { makeShopQueryClient } from "@/lib/shop/query-client";
import { ProductList } from "./ProductList";
import { ShopSortControl } from "./ShopSortControl";

/**
 * Page one of `sort`, prefetched through `getProductsPage` directly (not
 * HTTP) and dehydrated, inside a `"use cache"` scope. `sort` is the argument,
 * so there is one cache entry per sort.
 *
 * The cache scope is not optional. `QueryClient` and `dehydrate` stamp the
 * state with `Date.now()`, and under Cache Components reading the current
 * time outside a cache scope fails the `/shop` prerender
 * (`next-prerender-current-time`), even after awaiting cached IO first. The
 * Next docs give two other ways out, and both are worse here: `connection()`
 * makes `/shop` dynamic, and a Client Component would mean fetching page one
 * from the browser. Cached, the timestamp is simply the fill time.
 */
async function getFirstPageState(sort: ShopSort): Promise<DehydratedState> {
  "use cache";
  cacheTag("shop-products");
  cacheLife("days");

  const queryClient = makeShopQueryClient();
  await queryClient.prefetchInfiniteQuery({
    queryKey: shopProductsQueryKey(sort),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getProductsPage(pageParam, SHOP_PAGE_SIZE, sort),
  });

  return dehydrate(queryClient);
}

/**
 * Reads `sort` from the request and hands page one of that order to
 * `ProductList` in the hydrated query cache, so the client never fetches page
 * one. This whole component is the page's Suspense hole: awaiting
 * `searchParams` here is what makes it (and only it) dynamic.
 *
 * `sort` is parsed leniently: a hand-typed `?sort=foo` shows the default
 * order rather than an error. The control sits outside the
 * `HydrationBoundary` but inside the hole, so its value always matches the
 * list below it.
 */
export async function ShopProducts({ searchParams }: Pick<PageProps<"/shop">, "searchParams">) {
  const sort = shopSortSchema.catch(DEFAULT_SHOP_SORT).parse((await searchParams).sort);

  return (
    <>
      <ShopSortControl sort={sort} />
      <HydrationBoundary state={await getFirstPageState(sort)}>
        <ProductList sort={sort} />
      </HydrationBoundary>
    </>
  );
}
