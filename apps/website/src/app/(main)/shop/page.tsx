import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SHOP_PAGE_SIZE } from "@/lib/shop/pagination";
import { SELL_LINK_COPY, SELL_LINK_LABEL } from "@/lib/shop/seller-submission";
import { SITE_URL } from "@/lib/site";
import { ProductGridSkeleton } from "./ui/ProductGridSkeleton";
import { ShopControls } from "./ui/ShopControls";
import { ShopControlsFallback } from "./ui/ShopControlsFallback";
import { ShopGridBoundary } from "./ui/ShopGridBoundary";
import { ShopProducts } from "./ui/ShopProducts";

export const metadata: Metadata = {
  title: "Shop - issebya.homes",
  description: "Things from the house at issebya.homes, chosen for slow days by the coast.",
  alternates: { canonical: `${SITE_URL}/shop` },
};

// The page itself reads nothing from the request (no cookies(), no headers(),
// and it never awaits searchParams), so the shell stays static. There are two
// <Suspense> boundaries. The outer one is for ShopControls, which reads `sort`
// and `q` from the URL with useSearchParams; its fallback is the same controls
// row, disabled, around the skeleton, so the prerendered HTML already has the
// controls at their final size and nothing moves when they hydrate. The inner
// one is the list: ShopProducts awaits the searchParams promise, so it is the
// dynamic hole, with card-sized placeholders while page one first arrives (a
// later search or sort change keeps the old cards instead, see ShopControls).
// The canonical stays /shop, since the sort and search variants are the same
// content. The grid has its own error boundary (ShopGridBoundary) inside the
// controls' grid wrapper, so a failed page one degrades to a message under
// working controls while the rest of the page renders.
export default function ShopIndexPage({ searchParams }: PageProps<"/shop">) {
  return (
    <div>
      <section
        aria-label="Products"
        className="bg-shop-ground px-4 py-10 md:px-12 md:py-16 min-h-screen"
      >
        <Suspense
          fallback={
            <ShopControlsFallback>
              <ProductGridSkeleton count={SHOP_PAGE_SIZE} />
            </ShopControlsFallback>
          }
        >
          <ShopControls>
            <ShopGridBoundary>
              <Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}>
                <ShopProducts searchParams={searchParams} />
              </Suspense>
            </ShopGridBoundary>
          </ShopControls>
        </Suspense>
      </section>
      <p className="px-4 py-6 md:px-12 text-sm">
        {SELL_LINK_COPY}{" "}
        <Link href="/shop/sell" className="underline">
          {SELL_LINK_LABEL}
        </Link>
      </p>
    </div>
  );
}
