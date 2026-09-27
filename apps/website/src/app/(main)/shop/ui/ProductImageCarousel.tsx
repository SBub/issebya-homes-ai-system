"use client";

import Image from "next/image";
import Link from "next/link";
import posthog from "posthog-js";
import { type MouseEvent, type TouchEvent, useRef, useState } from "react";
import type { ProductImage } from "@/lib/shop/schema";

type Props = {
  images: ProductImage[];
  slug: string;
  // The card links its photo to the product; the product page doesn't link
  // to itself.
  href?: string;
  sizes: string;
  // The product page's first image is its LCP element; the card lazy-loads.
  priority?: boolean;
};

const SWIPE_THRESHOLD = 50;

/**
 * One product image at a time, with prev/next chevrons over the photo's left
 * and right edges and touch swipe. Used by the `/shop` card and by
 * `/shop/[slug]`.
 *
 * Only the current image is rendered, so the hidden ones are never requested.
 * The index is plain component state starting at 0, which keeps the server
 * render and the first client render identical.
 */
export function ProductImageCarousel({ images, slug, href, sizes, priority = false }: Props) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const swiped = useRef(false);

  const hasMany = images.length > 1;
  const current = images[index];

  const go = (delta: 1 | -1, trigger: "arrow" | "swipe") => {
    const next = (index + delta + images.length) % images.length;
    posthog.capture("shop_card_image_changed", { product_slug: slug, index: next, trigger });
    setIndex(next);
  };

  // The arrows sit outside the photo link, and this guard also keeps any
  // enclosing clickable from receiving the tap.
  const onArrow = (delta: 1 | -1) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    go(delta, "arrow");
  };

  const handleTouchStart = (event: TouchEvent) => {
    swiped.current = false;
    touchStartX.current = event.touches[0].clientX;
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (touchStartX.current === null) return;

    const diff = touchStartX.current - event.changedTouches[0].clientX;
    touchStartX.current = null;

    if (!hasMany || Math.abs(diff) <= SWIPE_THRESHOLD) return;

    swiped.current = true;
    go(diff > 0 ? 1 : -1, "swipe");
  };

  // A browser can follow a swipe with a synthetic click on the photo link;
  // that click must not navigate.
  const handleClickCapture = (event: MouseEvent) => {
    if (!swiped.current) return;

    event.preventDefault();
    event.stopPropagation();
    swiped.current = false;
  };

  const image = (
    <Image
      key={current.src}
      src={current.src}
      alt={current.alt}
      fill
      className="object-cover"
      sizes={sizes}
      priority={priority && index === 0}
    />
  );

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label="Product images"
      className="relative w-full h-full overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClickCapture={handleClickCapture}
    >
      {href ? (
        // A pointer-only duplicate of the card's name link, which carries the
        // accessible name. Hidden from the tab order and the accessibility
        // tree so each card announces one link, not two.
        <Link href={href} tabIndex={-1} aria-hidden="true" className="absolute inset-0">
          {image}
        </Link>
      ) : (
        image
      )}

      {hasMany && (
        <>
          <ArrowButton direction="previous" onClick={onArrow(-1)} />
          <ArrowButton direction="next" onClick={onArrow(1)} />
          <p className="sr-only" aria-live="polite">
            Image {index + 1} of {images.length}
          </p>
        </>
      )}
    </div>
  );
}

const ARROWS = {
  previous: { label: "Previous image", side: "left-0", points: "15 5 8 12 15 19" },
  next: { label: "Next image", side: "right-0", points: "9 5 16 12 9 19" },
};

function ArrowButton({
  direction,
  onClick,
}: {
  direction: keyof typeof ARROWS;
  onClick: (event: MouseEvent) => void;
}) {
  const { label, side, points } = ARROWS[direction];

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`group/arrow absolute top-1/2 -translate-y-1/2 ${side} flex items-center justify-center w-11 h-11 text-shop-card bg-transparent border-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-shop-card`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="group-hover/arrow:[stroke-width:2]"
      >
        <polyline points={points} />
      </svg>
    </button>
  );
}
