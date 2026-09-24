import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/app/ui/Breadcrumb";
import { allProducts, getProductBySlug } from "@/lib/shop/products";
import { formatPrice } from "@/lib/shop/schema";
import { SITE_URL } from "@/lib/site";
import { WishlistDialog } from "./ui/WishlistDialog";

export function generateStaticParams() {
  return allProducts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/shop/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const product = getProductBySlug(slug);

  // An unknown slug is a 404, not a build failure: the page itself calls
  // notFound(). Returning a plain title here keeps generateMetadata from
  // throwing first.
  if (!product) return { title: "Product not found - issebya.homes" };

  const url = `${SITE_URL}/shop/${product.slug}`;

  return {
    title: `${product.name} - issebya.homes`,
    description: product.description,
    alternates: { canonical: url },
    openGraph: {
      title: product.name,
      description: product.description,
      url,
      images: [{ url: product.image.src, alt: product.image.alt }],
    },
  };
}

// No `export const dynamic`, no searchParams, cookies() or headers() read
// anywhere in this route or its imports, so it prerenders. `dynamicParams` is
// left unset on purpose: notFound() already handles an unknown slug, and that
// keeps this route free of dynamic config flags under `cacheComponents`.
export default async function ProductPage(props: PageProps<"/shop/[slug]">) {
  const { slug } = await props.params;
  const product = getProductBySlug(slug);

  if (!product) notFound();

  const { brand, name, price, details, image } = product;

  return (
    <article className="p-4 md:p-12">
      <Breadcrumb parent={{ href: "/shop", label: "shop" }} title={name} />

      <div className="grid md:grid-cols-2 gap-8 bg-shop-card text-foreground p-4 md:p-8">
        <div className="relative w-full aspect-square">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 50vw, 100vw"
            priority
          />
        </div>

        <div className="flex flex-col gap-3">
          <p className="uppercase tracking-[0.2em] text-xs">{brand}</p>
          <h1 className="text-price">{name}</h1>
          <div className="flex items-center gap-3">
            <p className="font-medium">{formatPrice(price)}</p>
            <WishlistDialog productSlug={product.slug} productName={name} />
          </div>
          <p className="text-sm leading-relaxed max-w-[65ch] whitespace-pre-line">{details}</p>
        </div>
      </div>
    </article>
  );
}
