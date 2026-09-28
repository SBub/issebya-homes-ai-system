"use client";

import { type ReactNode, useEffect } from "react";
import { useShopControls } from "./ShopControls";

/**
 * The search's outcome for the list below the controls: the empty state when
 * a term matches nothing, and the match count reported to analytics. Both
 * come from page one, which is data, so this renders inside the list's
 * Suspense hole (from `ShopProducts`) rather than in the static shell with
 * the controls. It reaches back to `ShopControls` for `clear` and for the
 * "did the visitor ask for this term" check, which stay there in one place.
 */
export function ShopResults({
  q,
  total,
  children,
}: {
  q: string;
  total: number;
  children: ReactNode;
}) {
  const { clear, reportResults } = useShopControls();

  // Once the server-confirmed results have committed.
  useEffect(() => {
    reportResults(q, total);
  }, [q, total, reportResults]);

  if (q !== "" && total === 0) {
    return (
      <div role="status" className="py-16 text-center text-background">
        <p>Nothing matches &quot;{q}&quot;. Try another word or clear the search.</p>
        <button
          type="button"
          onClick={clear}
          className="mt-4 border border-background px-6 py-2 uppercase tracking-[0.2em] text-xs cursor-pointer"
        >
          Clear
        </button>
      </div>
    );
  }

  return children;
}
