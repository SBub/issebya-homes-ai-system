import Image from "next/image";
import Link from "next/link";
import { toRoman } from "@/lib/shop/roman";
import { formatPrice, type Product } from "@/lib/shop/schema";

/**
 * One cream card in the `/shop` grid. The whole card is a single link to the
 * product page.
 *
 * `aria-labelledby` points at the name, so the link's accessible name is the
 * product name alone. Without it a screen reader would read the numeral, the
 * brand, the image alt, the price and the description as one long link name.
 *
 * A portrait 3:5 card with the photo filling the top 58%, per the design. The
 * one exception is the three-column `md` range (768-1023px), where a 3:5 card
 * is too short for the name, price and three-line description. There it uses a
 * portrait `min-h` instead. `h-full` makes the link's height definite, so the
 * photo's 58% basis resolves, and the grid's default `stretch` keeps every card
 * in a row the same height.
 */
export function ProductCard({ product, position }: { product: Product; position: number }) {
  const { slug, brand, name, price, description, image } = product;
  const nameId = `product-${slug}-name`;

  return (
    <Link
      href={`/shop/${slug}`}
      aria-labelledby={nameId}
      className="group flex flex-col h-full aspect-[3/5] md:max-lg:aspect-auto md:max-lg:min-h-[26rem] bg-shop-card text-foreground p-3.5"
    >
      <div className="relative w-full basis-[58%] shrink-0 overflow-hidden">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          className="object-cover"
          sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-3 text-xs">
        <span>{toRoman(position)}</span>
        <p className="text-center uppercase tracking-[0.2em] text-[10px]">{brand}</p>
        <div className="flex justify-between gap-2 font-medium text-sm">
          <span id={nameId} className="group-hover:underline underline-offset-4">
            {name}
          </span>
          <span className="shrink-0">{formatPrice(price)}</span>
        </div>
        <p className="leading-relaxed line-clamp-3">{description}</p>
      </div>
    </Link>
  );
}
