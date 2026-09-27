"use client";

import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import posthog from "posthog-js";
import { useCallback } from "react";
import {
  DEFAULT_SHOP_SORT,
  type ProductsPage,
  SHOP_PAGE_SIZE,
  type ShopSort,
  shopProductsQueryKey,
} from "@/lib/shop/pagination";
import { ProductCard } from "./ProductCard";
import { PRODUCT_GRID_CLASS, ProductGridSkeleton } from "./ProductGridSkeleton";

// Fills out one three-column row, enough to show more is on its way.
const NEXT_PAGE_SKELETON_COUNT = Math.min(SHOP_PAGE_SIZE, 3);

async function fetchProductsPage(
  cursor: string | null,
  sort: ShopSort,
  signal: AbortSignal,
): Promise<ProductsPage> {
  // Relative URL: this only ever runs in the browser. The default sort is
  // left out, matching the page's own URL convention.
  const params = new URLSearchParams({ limit: String(SHOP_PAGE_SIZE) });
  if (cursor !== null) params.set("cursor", cursor);
  if (sort !== DEFAULT_SHOP_SORT) params.set("sort", sort);

  const res = await fetch(`/api/shop/products?${params}`, { signal });
  if (!res.ok) throw new Error(`Products request failed: ${res.status}`);
  return res.json();
}

/**
 * The `/shop` grid as an infinite list.
 *
 * A deliberate exception to "don't fetch from a Client Component": page one
 * still comes from the server (`ShopProducts` prefetches it into the
 * hydrated cache), and only pages 2+ are fetched here, from
 * `GET /api/shop/products`.
 *
 * The query key carries the sort, so switching sort is a new query that
 * starts at a fresh page one, with no effect and no manual cache reset. The
 * server prefetch for the new sort arrives with the RSC payload of the
 * `router.replace` that changed it, so that page one is normally hydrated
 * rather than fetched.
 *
 * `useSuspenseInfiniteQuery` rather than `useInfiniteQuery` (same options):
 * the server hands over page one as a still-pending query, and only the
 * suspense variant suspends on it into the list's `<Suspense>` skeleton. The
 * plain hook would render an empty pending state instead.
 *
 * `refetchOnMount: false`: the hydrated page one carries the time its server
 * cache entry was filled (the `/shop` shell revalidates daily), so it is
 * often past the hour's `staleTime` on arrival. Refetching it on mount would
 * be exactly the page-one client fetch the prefetch exists to avoid.
 */
export function ProductList({ sort }: { sort: ShopSort }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    useSuspenseInfiniteQuery({
      queryKey: shopProductsQueryKey(sort),
      initialPageParam: null as string | null,
      getNextPageParam: (last: ProductsPage) => last.nextCursor,
      queryFn: ({ pageParam, signal }) => fetchProductsPage(pageParam, sort, signal),
      refetchOnMount: false,
    });

  // Reports every page after the first. Page one arrives by prefetch, never
  // through here, and background refetches are not reported either.
  const loadMore = useCallback(async () => {
    const result = await fetchNextPage();
    if (result.isError) return;

    const pages = result.data?.pages ?? [];
    posthog.capture("shop_products_page_loaded", {
      page_index: pages.length - 1,
      items: pages.at(-1)?.items.length ?? 0,
    });
  }, [fetchNextPage]);

  // A callback ref, so React attaches and cleans up the observer with the
  // sentinel. The observer is only armed while there is a page to load and no
  // fetch in flight, and it is recreated only when that changes (twice per
  // page), not on every render. A fresh observer reports the current state on
  // `observe`, so a sentinel still in view after a page lands loads the next.
  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useCallback(
    (sentinel: HTMLDivElement | null) => {
      if (!sentinel || !canLoadMore) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            observer.disconnect();
            void loadMore();
          }
        },
        { rootMargin: "400px 0px" },
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    },
    [canLoadMore, loadMore],
  );

  const products = data.pages.flatMap((page) => page.items);

  return (
    <>
      <ul className={PRODUCT_GRID_CLASS}>
        {products.map((product) => (
          <li key={product.slug}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>

      {isFetchingNextPage && (
        <div className="mt-6">
          <ProductGridSkeleton count={NEXT_PAGE_SKELETON_COUNT} />
        </div>
      )}

      <div
        ref={sentinelRef}
        aria-hidden="true"
        data-testid="shop-products-sentinel"
        className="h-px"
      />

      {isFetchNextPageError && (
        <p role="alert" className="mt-6 text-center text-sm text-background">
          Couldn&apos;t load more products.{" "}
          <button type="button" onClick={loadMore} className="underline">
            Try again
          </button>
        </p>
      )}

      {hasNextPage && !isFetchNextPageError && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={isFetchingNextPage}
            className="border border-background px-6 py-2 text-sm text-background disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      )}
    </>
  );
}
