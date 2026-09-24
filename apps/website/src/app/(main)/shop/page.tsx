import type { Metadata } from "next";
import Link from "next/link";
import { allProducts } from "@/lib/shop/products";
import { SELL_LINK_COPY, SELL_LINK_LABEL } from "@/lib/shop/seller-submission";
import { SITE_URL } from "@/lib/site";
import { ProductCard } from "./ui/ProductCard";

export const metadata: Metadata = {
  title: "Shop - issebya.homes",
  description: "Things from the house at issebya.homes, chosen for slow days by the coast.",
  alternates: { canonical: `${SITE_URL}/shop` },
};

// Reads nothing from the request (no cookies(), no headers(), no
// searchParams), so this route stays part of the static shell.
export default function ShopIndexPage() {
  return (
    <div>
      <section aria-label="Products" className="bg-shop-ground px-4 py-10 md:px-12 md:py-16">
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {allProducts.map((product, index) => (
            <li key={product.slug}>
              <ProductCard product={product} position={index + 1} />
            </li>
          ))}
        </ul>
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
