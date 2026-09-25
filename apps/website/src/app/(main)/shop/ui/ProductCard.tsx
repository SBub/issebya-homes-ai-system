import Link from "next/link";
import { toRoman } from "@/lib/shop/roman";
import { formatPrice, type Product } from "@/lib/shop/schema";
import { ProductImageCarousel } from "./ProductImageCarousel";

/**
 * One cream card in the `/shop` grid.
 *
 * The card is an `<article>`, not one big link: the carousel's arrows are
 * buttons, and a button inside an `<a>` is invalid HTML that navigates on
 * every tap. The product name is the card's link and carries its accessible
 * name; `aria-labelledby` names the article after it too. The photo is a
 * second, pointer-only link to the same page (see `ProductImageCarousel`).
 *
 * A portrait 3:5 card with the photo filling the top 58%, per the design. The
 * one exception is the three-column `md` range (768-1023px), where a 3:5 card
 * is too short for the name, price and three-line description. There it uses a
 * portrait `min-h` instead. `h-full` makes the card's height definite, so the
 * photo's 58% basis resolves, and the grid's default `stretch` keeps every card
 * in a row the same height.
 */
export function ProductCard({ product, position }: { product: Product; position: number }) {
  const { slug, brand, name, price, description, images } = product;
  const nameId = `product-${slug}-name`;
  const href = `/shop/${slug}`;

  return (
    <article
      aria-labelledby={nameId}
      className="group flex flex-col h-full aspect-[3/5] md:max-lg:aspect-auto md:max-lg:min-h-[26rem] bg-shop-card text-foreground p-3.5"
    >
      <div className="relative w-full basis-[58%] shrink-0 overflow-hidden">
        <ProductImageCarousel
          images={images}
          slug={slug}
          href={href}
          sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-3 text-xs">
        <span>{toRoman(position)}</span>
        <p className="text-center uppercase tracking-[0.2em] text-[10px]">{brand}</p>
        <div className="flex justify-between gap-2 font-medium text-sm">
          <Link
            href={href}
            id={nameId}
            className="group-hover:underline hover:underline underline-offset-4"
          >
            {name}
          </Link>
          <span className="shrink-0">{formatPrice(price)}</span>
        </div>
        <p className="leading-relaxed line-clamp-3">{description}</p>
      </div>
    </article>
  );
}
