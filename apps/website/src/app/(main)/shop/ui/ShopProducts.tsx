import { type DehydratedState, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cacheLife, cacheTag } from "next/cache";
import { getProductsPage } from "@/lib/shop/pages";
import {
  DEFAULT_SHOP_SORT,
  SHOP_PAGE_SIZE,
  type ShopSort,
  shopProductsQueryKey,
  shopSearchSchema,
  shopSortSchema,
} from "@/lib/shop/pagination";
import { makeShopQueryClient } from "@/lib/shop/query-client";
import { ProductList } from "./ProductList";
import { ShopControls } from "./ShopControls";

/**
 * Page one of `sort` and `q`, prefetched through `getProductsPage` directly
 * (not HTTP) and dehydrated, inside a `"use cache"` scope. `sort` and `q` are
 * the arguments, so there is one cache entry per sort and search term.
 *
 * The cache scope is not optional. `QueryClient` and `dehydrate` stamp the
 * state with `Date.now()`, and under Cache Components reading the current
 * time outside a cache scope fails the `/shop` prerender
 * (`next-prerender-current-time`), even after awaiting cached IO first. The
 * Next docs give two other ways out, and both are worse here: `connection()`
 * makes `/shop` dynamic, and a Client Component would mean fetching page one
 * from the browser. Cached, the timestamp is simply the fill time.
 */
async function getFirstPageState(sort: ShopSort, q: string): Promise<DehydratedState> {
  "use cache";
  cacheTag("shop-products");
  cacheLife("days");

  const queryClient = makeShopQueryClient();
  await queryClient.prefetchInfiniteQuery({
    queryKey: shopProductsQueryKey(sort, q),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getProductsPage(pageParam, SHOP_PAGE_SIZE, sort, q),
  });

  return dehydrate(queryClient);
}

/**
 * Reads `sort` and `q` from the request and hands page one of those results
 * to `ProductList` in the hydrated query cache, so the client never fetches
 * page one. This whole component is the page's Suspense hole: awaiting
 * `searchParams` here is what makes it (and only it) dynamic.
 *
 * Both are parsed leniently: a hand-typed `?sort=foo`, an over-long `?q=` or
 * a repeated one shows the default order or the full grid rather than an
 * error. The controls and the dimmed grid wrapper sit outside the
 * `HydrationBoundary` but inside the hole, so their values always match the
 * list inside them.
 */
export async function ShopProducts({ searchParams }: Pick<PageProps<"/shop">, "searchParams">) {
  const params = await searchParams;
  const sort = shopSortSchema.catch(DEFAULT_SHOP_SORT).parse(params.sort);
  const q = shopSearchSchema.catch("").parse(params.q);

  // The same cache entry the prefetch below fills, so no extra work.
  const { total } = await getProductsPage(null, SHOP_PAGE_SIZE, sort, q);

  return (
    <ShopControls sort={sort} q={q} total={total}>
      <HydrationBoundary state={await getFirstPageState(sort, q)}>
        <ProductList sort={sort} q={q} />
      </HydrationBoundary>
    </ShopControls>
  );
}
