"use client";

import type { ReactNode } from "react";
import { DEFAULT_SHOP_SORT } from "@/lib/shop/pagination";
import { ShopSearch } from "./ShopSearch";
import { ShopSortControl } from "./ShopSortControl";

/**
 * The controls row, shared with `ShopControls`. The explicit min height is the
 * row's measured height: the search form (233 px) and the sort (216 px) wrap
 * onto two 44 px lines below a 497 px viewport with macOS fonts, and share one
 * line from there up. Linux Chromium (CI) renders the labels wider and needs
 * more, so the one-line box applies from 560 px, which leaves margin for that
 * difference. The prerendered row and the hydrated one are then the same size
 * even if their contents ever drift.
 */
export const SHOP_CONTROLS_ROW_CLASS =
  "mb-6 flex min-h-[104px] min-[560px]:min-h-11 flex-wrap items-center justify-between gap-4 text-background";

/** The grid wrapper's base class, shared with `ShopControls`. */
export const SHOP_GRID_WRAPPER_CLASS = "transition-opacity";

const noop = () => {};

/**
 * The `<Suspense>` fallback for `ShopControls`, and so what the prerendered
 * `/shop` HTML contains: `ShopControls` reads the URL with `useSearchParams`,
 * which renders nothing in the static shell but its nearest fallback.
 *
 * It is the same DOM as the real row (the same search form and sort select)
 * around the same grid wrapper, so when hydration swaps in `ShopControls`
 * nothing moves. Both inputs are disabled: the URL is not known yet, so they
 * show the defaults, and a term typed here would be lost on hydration.
 */
export function ShopControlsFallback({ children }: { children: ReactNode }) {
  return (
    <>
      <div className={SHOP_CONTROLS_ROW_CLASS}>
        <ShopSearch
          value=""
          sort={DEFAULT_SHOP_SORT}
          onChange={noop}
          onSubmit={noop}
          onEscape={noop}
          busy={false}
          disabled
        />
        <ShopSortControl value={DEFAULT_SHOP_SORT} onChange={noop} busy={false} disabled />
      </div>
      <div className={SHOP_GRID_WRAPPER_CLASS}>{children}</div>
    </>
  );
}
