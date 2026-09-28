"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { type ShopSort, shopHref, shopParamsFromSearch } from "@/lib/shop/pagination";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { SHOP_CONTROLS_ROW_CLASS, SHOP_GRID_WRAPPER_CLASS } from "./ShopControlsFallback";
import { ShopSearch } from "./ShopSearch";
import { ShopSortControl } from "./ShopSortControl";

const SHOP_SEARCH_DEBOUNCE_MS = 300;

type ShopControlsContextValue = {
  /** Empties the box and returns to the unfiltered list. */
  clear: () => void;
  /** Reports a term's server-confirmed match count, if the visitor applied it. */
  reportResults: (q: string, total: number) => void;
};

const ShopControlsContext = createContext<ShopControlsContextValue | null>(null);

/** `ShopControls`' search actions, for `ShopResults` inside its grid. */
export function useShopControls(): ShopControlsContextValue {
  const value = use(ShopControlsContext);
  if (value === null) throw new Error("useShopControls must be used inside ShopControls");
  return value;
}

/**
 * The `/shop` search box and sort select, and the grid they drive, under one
 * `useTransition`. `sort` and `q` come from the URL through
 * `useSearchParams`, parsed exactly as the server parses them, so the
 * controls depend on nothing but the URL and sit in the page's static shell.
 * That also means they need their own `<Suspense>`, whose fallback
 * (`ShopControlsFallback`) is the same row, disabled. The list, the empty
 * state and the match count arrive from the server as `children`
 * (`ShopResults`, through the context above); this only writes the URL.
 *
 * Every URL change runs inside `startTransition`. That is what keeps the old
 * cards on screen while the new server render (and its hydrated page one)
 * arrives: React will not replace the list's already-revealed Suspense
 * boundary with its fallback for a transition, so the skeleton only ever
 * shows on first load. Meanwhile the grid is dimmed and `aria-busy`.
 *
 * The input shows every keystroke; only the term sent to the URL waits for a
 * 300 ms pause. Enter sends it at once, and so do Escape and emptying the
 * box. Search replaces the history entry, so Back leaves the shop rather
 * than stepping through terms; sort pushes one, so back/forward restore the
 * previous order.
 */
export function ShopControls({ children }: { children: ReactNode }) {
  const { sort, q } = shopParamsFromSearch(useSearchParams());
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
  // Stable (refs only), so `ShopResults`' effect runs per result, not per
  // render of this component.
  const reportResults = useCallback((resultQ: string, total: number) => {
    if (resultQ !== "" && resultQ === requestedRef.current) {
      posthog.capture("shop_search_applied", { length: resultQ.length, results: total });
      requestedRef.current = null;
    }
  }, []);

  const onTextChange = (next: string) => {
    setText(next);
    if (next.trim() === "") setApplied("");
  };

  const clear = useCallback(() => {
    setText("");
    setApplied("");
  }, []);

  const context = useMemo(() => ({ clear, reportResults }), [clear, reportResults]);

  const onSortChange = (next: ShopSort) => {
    startTransition(() => {
      setShownSort(next);
      router.push(shopHref(pathname, { sort: next, q: applied }), { scroll: false });
    });
    posthog.capture("shop_sort_changed", { sort: next });
  };

  return (
    <ShopControlsContext value={context}>
      <div className={SHOP_CONTROLS_ROW_CLASS}>
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
        className={`${SHOP_GRID_WRAPPER_CLASS} ${isPending ? "opacity-50" : ""}`}
      >
        {children}
      </div>
    </ShopControlsContext>
  );
}
