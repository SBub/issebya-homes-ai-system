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
 * Its native appearance is reset so WebKit and Blink draw the same box; the
 * chevron is ours.
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
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(shopSortSchema.parse(event.target.value))}
          aria-busy={busy}
          disabled={disabled}
          className="h-11 min-h-11 appearance-none [-webkit-appearance:none] rounded-none pl-3 pr-8 border border-background/60 bg-transparent uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-background"
        >
          {SHOP_SORTS.map((option) => (
            <option key={option} value={option} className="text-foreground">
              {SORT_LABELS[option]}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          focusable="false"
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </div>
    </div>
  );
}
