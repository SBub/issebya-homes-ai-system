import { PRODUCT_CARD_BOX_CLASS } from "./ProductCard";

/** The `/shop` grid, shared by the product list and its skeleton so they cannot drift. */
export const PRODUCT_GRID_CLASS = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6";

/**
 * Card-sized placeholders for products that are still loading: the list's
 * Suspense fallback (a full page) and the tail shown while the next page is
 * fetched. Each box is the card's own outer box, so nothing shifts when the
 * cards replace it. Non-interactive; one status line tells assistive tech.
 */
export function ProductGridSkeleton({ count }: { count: number }) {
  return (
    <>
      <p role="status" className="sr-only">
        Loading products
      </p>
      <ul aria-hidden="true" className={PRODUCT_GRID_CLASS}>
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <div className={PRODUCT_CARD_BOX_CLASS}>
              <div className="basis-[58%] shrink-0 bg-foreground/10 motion-safe:animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
