"use client";

import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useId, useOptimistic, useTransition } from "react";
import {
  DEFAULT_SHOP_SORT,
  SHOP_SORTS,
  type ShopSort,
  shopSortSchema,
} from "@/lib/shop/pagination";

const SORT_LABELS: Record<ShopSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

/**
 * The `/shop` sort `<select>`. The server reads `sort` from the URL and passes
 * it in (no `useSearchParams`, which would need its own Suspense boundary and
 * duplicate the source of truth); this only writes the URL.
 *
 * `useOptimistic` shows the new choice at once, while `router.push` fetches the
 * server render for it inside the transition. Pushing (not replacing) gives
 * each choice a history entry, so back/forward restore the previous order. The
 * default sort pushes the bare pathname, so it never adds a query string.
 */
export function ShopSortControl({ sort }: { sort: ShopSort }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(sort);
  const id = useId();

  const onChange = (value: string) => {
    const next = shopSortSchema.parse(value);

    startTransition(() => {
      setShown(next);
      router.push(next === DEFAULT_SHOP_SORT ? pathname : `${pathname}?sort=${next}`, {
        scroll: false,
      });
    });
    posthog.capture("shop_sort_changed", { sort: next });
  };

  return (
    <div className="mb-6 flex items-center justify-end gap-3 text-background">
      <label htmlFor={id} className="uppercase tracking-[0.2em] text-xs">
        Sort
      </label>
      <select
        id={id}
        value={shown}
        onChange={(event) => onChange(event.target.value)}
        aria-busy={isPending}
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
