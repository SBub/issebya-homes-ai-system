import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";

/** One hour, for both staleness and garbage collection of shop pages. */
const SHOP_QUERY_TTL_MS = 60 * 60 * 1000;

/**
 * The QueryClient for `/shop`, shared by the server prefetch (`ShopProducts`)
 * and the client provider (`ShopProviders`) so both agree on the options.
 *
 * Pending queries are dehydrated too (TanStack's streaming pattern): the server
 * hands the not-yet-resolved page-one promise to the client through RSC, and
 * the client's suspense query picks it up instead of fetching page one again.
 */
export function makeShopQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: SHOP_QUERY_TTL_MS,
        gcTime: SHOP_QUERY_TTL_MS,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}
