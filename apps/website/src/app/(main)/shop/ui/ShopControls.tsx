"use client";

import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { type ShopSort, shopHref } from "@/lib/shop/pagination";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ShopSearch } from "./ShopSearch";
import { ShopSortControl } from "./ShopSortControl";

const SHOP_SEARCH_DEBOUNCE_MS = 300;

/**
 * The `/shop` search box and sort select, and the grid they drive, under one
 * `useTransition`. The server reads `sort` and `q` from the URL and passes
 * them in with `total`, the match count; this only writes the URL.
 *
 * Every URL change runs inside `startTransition`. That is what keeps the old
 * cards on screen while the new server render (and its hydrated page one)
 * arrives: React will not replace the already-revealed `/shop` Suspense
 * boundary with its fallback for a transition, so the skeleton only ever
 * shows on first load. Meanwhile the grid is dimmed and `aria-busy`.
 *
 * The input shows every keystroke; only the term sent to the URL waits for a
 * 300 ms pause. Enter sends it at once, and so do Escape and emptying the
 * box. Search replaces the history entry, so Back leaves the shop rather
 * than stepping through terms; sort pushes one, so back/forward restore the
 * previous order.
 */
export function ShopControls({
  sort,
  q,
  total,
  children,
}: {
  sort: ShopSort;
  q: string;
  total: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [shownSort, setShownSort] = useOptimistic(sort);

  // `text` is the raw input; `applied` is the term the URL should carry,
  // trimmed. Every way of changing the search only sets `applied`; the one
  // effect below writes it to the URL.
  const [text, setText] = useState(q);
  const [applied, setApplied] = useState(q);

  // The term whose results should be reported once the server confirms them.
  const requestedRef = useRef<string | null>(null);

  // A `q` this component did not ask for (the header's Shop link to bare
  // `/shop`, back/forward) resets the box. Adjusted during render, not in an
  // effect. A `q` arriving while one of ours is still in flight is an older
  // term the visitor has already typed past, so it leaves the box alone.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (q !== applied && !isPending) {
      setText(q);
      setApplied(q);
    }
  }

  // A pause in typing applies the text. Also adjusted during render; a no-op
  // when Enter, Escape or emptying the box already applied it.
  const debounced = useDebouncedValue(text, SHOP_SEARCH_DEBOUNCE_MS);
  const [seenDebounced, setSeenDebounced] = useState(debounced);
  if (debounced !== seenDebounced) {
    setSeenDebounced(debounced);
    setApplied(debounced.trim());
  }

  // Synchronises `applied` to the URL, the external system here. `sentRef` is
  // the term the URL carries or is about to: nothing to do when it already
  // matches, or when a settled URL already carries the term (first render, a
  // reset from outside). While one of ours is in flight, `q` is stale, so an
  // Escape back to the old term still navigates.
  const sentRef = useRef(q);
  const replaceUrl = useEffectEvent((term: string) => {
    if (term === sentRef.current) return;
    if (term === q && !isPending) {
      sentRef.current = term;
      return;
    }
    sentRef.current = term;
    requestedRef.current = term;
    startTransition(() => {
      router.replace(shopHref(pathname, { sort: shownSort, q: term }), { scroll: false });
    });
  });
  useEffect(() => {
    replaceUrl(applied);
  }, [applied]);

  // Once per applied non-empty term, with its real match count. Not per
  // keystroke, not for a shared link's first render, not for a sort change.
  useEffect(() => {
    if (q !== "" && q === requestedRef.current) {
      posthog.capture("shop_search_applied", { length: q.length, results: total });
      requestedRef.current = null;
    }
  }, [q, total]);

  const onTextChange = (next: string) => {
    setText(next);
    if (next.trim() === "") setApplied("");
  };

  const clear = () => {
    setText("");
    setApplied("");
  };

  const onSortChange = (next: ShopSort) => {
    startTransition(() => {
      setShownSort(next);
      router.push(shopHref(pathname, { sort: next, q: applied }), { scroll: false });
    });
    posthog.capture("shop_sort_changed", { sort: next });
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 text-background">
        <ShopSearch
          value={text}
          sort={shownSort}
          onChange={onTextChange}
          onSubmit={() => setApplied(text.trim())}
          onEscape={clear}
          busy={isPending}
        />
        <ShopSortControl value={shownSort} onChange={onSortChange} busy={isPending} />
      </div>

      <div
        data-testid="shop-grid"
        aria-busy={isPending || undefined}
        className={`transition-opacity ${isPending ? "opacity-50" : ""}`}
      >
        {q !== "" && total === 0 ? (
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
        ) : (
          children
        )}
      </div>
    </>
  );
}
