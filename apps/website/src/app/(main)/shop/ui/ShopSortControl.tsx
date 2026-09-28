"use client";

import { useId } from "react";
import { SHOP_SORTS, type ShopSort, shopSortSchema } from "@/lib/shop/pagination";

const SORT_LABELS: Record<ShopSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

/**
 * The `/shop` sort `<select>`, controlled by `ShopControls`, which owns the
 * transition, the URL and the analytics. `busy` marks it while a new order
 * (or a new search) is loading. `disabled` is for `ShopControlsFallback`.
 */
export function ShopSortControl({
  value,
  onChange,
  busy,
  disabled,
}: {
  value: ShopSort;
  onChange: (next: ShopSort) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const id = useId();

  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="uppercase tracking-[0.2em] text-xs">
        Sort
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(shopSortSchema.parse(event.target.value))}
        aria-busy={busy}
        disabled={disabled}
        className="min-h-11 px-3 border border-background/60 bg-transparent uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-background"
      >
        {SHOP_SORTS.map((option) => (
          <option key={option} value={option} className="text-foreground">
            {SORT_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
