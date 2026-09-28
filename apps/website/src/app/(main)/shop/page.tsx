import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SHOP_PAGE_SIZE } from "@/lib/shop/pagination";
import { SELL_LINK_COPY, SELL_LINK_LABEL } from "@/lib/shop/seller-submission";
import { SITE_URL } from "@/lib/site";
import { ProductGridSkeleton } from "./ui/ProductGridSkeleton";
import { ShopGridBoundary } from "./ui/ShopGridBoundary";
import { ShopProducts } from "./ui/ShopProducts";

export const metadata: Metadata = {
  title: "Shop - issebya.homes",
  description: "Things from the house at issebya.homes, chosen for slow days by the coast.",
  alternates: { canonical: `${SITE_URL}/shop` },
};

// The page itself reads nothing from the request (no cookies(), no headers(),
// and it never awaits searchParams), so the shell stays static. It passes the
// searchParams promise into the product list, the one <Suspense> hole, which
// awaits it for `sort` and `q`: only the hole is dynamic, with card-sized
// placeholders while page one first arrives (a later search or sort change
// keeps the old cards instead, see ShopControls). The canonical stays /shop,
// since the sort and search variants are the same content. The grid has its
// own error boundary (ShopGridBoundary), so a failed page one degrades to a
// message inside the section while the rest of the page renders.
export default function ShopIndexPage({ searchParams }: PageProps<"/shop">) {
  return (
    <div>
      <section
        aria-label="Products"
        className="bg-shop-ground px-4 py-10 md:px-12 md:py-16 min-h-screen"
      >
        <ShopGridBoundary>
          <Suspense fallback={<ProductGridSkeleton count={SHOP_PAGE_SIZE} />}>
            <ShopProducts searchParams={searchParams} />
          </Suspense>
        </ShopGridBoundary>
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
