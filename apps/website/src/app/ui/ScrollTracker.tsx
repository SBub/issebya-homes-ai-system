"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { trackScrolled50 } from "@/lib/analytics";

interface ScrollTrackerProps {
  page: string;
}

function createScrollStore() {
  let rafId: number | null = null;
  let ticking = false;
  let cachedPercent = 0;

  function getScrollPercent(): number {
    if (typeof window === "undefined") return 0;
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollableHeight <= 0) return 0;
    return (window.scrollY / scrollableHeight) * 100;
  }

  return {
    subscribe(callback: () => void): () => void {
      function handleScroll() {
        if (!ticking) {
          rafId = window.requestAnimationFrame(() => {
            cachedPercent = getScrollPercent();
            callback();
            ticking = false;
          });
          ticking = true;
        }
      }

      window.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        window.removeEventListener("scroll", handleScroll);
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
      };
    },
    getSnapshot(): number {
      return cachedPercent;
    },
    getServerSnapshot(): number {
      return 0;
    },
  };
}

const scrollStore = createScrollStore();

export function ScrollTracker({ page }: ScrollTrackerProps) {
  const hasTrackedRef = useRef(false);

  const scrollPercent = useSyncExternalStore(
    scrollStore.subscribe,
    scrollStore.getSnapshot,
    scrollStore.getServerSnapshot,
  );

  useEffect(() => {
    if (hasTrackedRef.current) return;
    if (scrollPercent >= 50) {
      trackScrolled50(page);
      hasTrackedRef.current = true;
    }
  }, [scrollPercent, page]);

  return null;
}
