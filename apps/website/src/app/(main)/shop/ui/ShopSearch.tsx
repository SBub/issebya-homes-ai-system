"use client";

import { useId } from "react";
import { DEFAULT_SHOP_SORT, SHOP_SEARCH_MAX_LENGTH, type ShopSort } from "@/lib/shop/pagination";

/**
 * The `/shop` search box, controlled by `ShopControls`, which decides when a
 * term reaches the URL. Without JavaScript it is a plain `GET` form to
 * `/shop`: Enter submits the single field, and the hidden `sort` keeps the
 * current order.
 */
export function ShopSearch({
  value,
  sort,
  onChange,
  onSubmit,
  onEscape,
  busy,
}: {
  value: string;
  sort: ShopSort;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
  busy: boolean;
}) {
  const id = useId();

  return (
    <form
      role="search"
      action="/shop"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex items-center gap-3"
    >
      <label htmlFor={id} className="uppercase tracking-[0.2em] text-xs">
        Search
      </label>
      <input
        type="search"
        id={id}
        name="q"
        aria-label="Search products"
        placeholder="Search pieces"
        maxLength={SHOP_SEARCH_MAX_LENGTH}
        autoComplete="off"
        value={value}
        aria-busy={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Handled here rather than left to the browser's own search-clear,
          // which differs between browsers.
          if (event.key === "Escape") {
            event.preventDefault();
            onEscape();
          }
        }}
        className="min-h-11 px-3 border border-background/60 bg-transparent text-xs tracking-[0.2em] placeholder:uppercase placeholder:text-background/60 transition-colors hover:border-background focus:border-background"
      />
      {sort !== DEFAULT_SHOP_SORT && <input type="hidden" name="sort" value={sort} />}
    </form>
  );
}
