import Link from "next/link";
import { formatPrice, type Product } from "@/lib/shop/schema";
import { ProductImageCarousel } from "./ProductImageCarousel";

/**
 * One cream card in the `/shop` grid.
 *
 * The card is an `<article>`, not one big link: the carousel's arrows are
 * buttons, and a button inside an `<a>` is invalid HTML that navigates on
 * every tap. The product name is still the card's single accessible link and
 * carries its accessible name; `aria-labelledby` names the article after it
 * too. Its `::after` stretches over the whole article (a "stretched link"), so
 * a press on the brand, price, description or padding lands on the name link.
 *
 * The photo wrapper is `z-10`, above that overlay, so over the photo the
 * carousel keeps the pointer: its second, pointer-only link to the same page
 * (see `ProductImageCarousel`), its arrows and its touch swipe. If the overlay
 * covered the photo, touch events would target the name `<a>` outside the
 * carousel and swipe would break. The trade-off is that the text below the
 * photo cannot be selected by dragging. That is deliberate: a `pointer-events`
 * workaround reopens the dead area this pattern closes.
 *
 * A portrait 3:5 card with the photo filling the top 58%, per the design. The
 * one exception is the three-column `md` range (768-1023px), where a 3:5 card
 * is too short for the name, price and three-line description. There it uses a
 * portrait `min-h` instead. `h-full` makes the card's height definite, so the
 * photo's 58% basis resolves, and the grid's default `stretch` keeps every card
 * in a row the same height.
 */
/**
 * The card's outer box, shared with `ProductGridSkeleton` so a placeholder
 * takes exactly the space the card will.
 */
export const PRODUCT_CARD_BOX_CLASS =
  "flex flex-col h-full aspect-[3/5] md:max-lg:aspect-auto md:max-lg:min-h-[26rem] bg-shop-card p-3.5";

export function ProductCard({ product }: { product: Product }) {
  const { slug, brand, name, price, description, images } = product;
  const nameId = `product-${slug}-name`;
  const href = `/shop/${slug}`;

  return (
    <article
      aria-labelledby={nameId}
      className={`group relative ${PRODUCT_CARD_BOX_CLASS} text-foreground`}
    >
      <div className="relative z-10 w-full basis-[58%] shrink-0 overflow-hidden">
        <ProductImageCarousel
          images={images}
          slug={slug}
          href={href}
          sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-3 text-xs">
        <p className="text-center uppercase tracking-[0.2em] text-[10px]">{brand}</p>
        <div className="flex justify-between gap-2 font-medium text-sm">
          <Link
            href={href}
            id={nameId}
            className="group-hover:underline hover:underline underline-offset-4 after:absolute after:inset-0 after:content-['']"
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
