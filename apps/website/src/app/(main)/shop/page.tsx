import type { Metadata } from "next";
import { allProducts } from "@/lib/shop/products";
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
      <div className="p-4 md:p-12">
        <h1 className="text-4xl font-hand font-bold">Shop</h1>
      </div>

      <section aria-label="Products" className="bg-shop-ground px-4 py-10 md:px-12 md:py-16">
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {allProducts.map((product, index) => (
            <li key={product.slug}>
              <ProductCard product={product} position={index + 1} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
