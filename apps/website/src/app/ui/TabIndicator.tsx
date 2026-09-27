"use client";

import { useLayoutEffect, useRef, useState } from "react";

type TabIndicatorProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  activeId: string;
};

export function TabIndicator({ containerRef, activeId }: TabIndicatorProps) {
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  const measureFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    let attachFrameId: number | null = null;
    let observer: ResizeObserver | null = null;

    const attach = () => {
      const container = containerRef.current;
      if (!container) {
        attachFrameId = requestAnimationFrame(attach);
        return;
      }

      const measure = () => {
        const activeEl = container.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
        if (!activeEl) return;
        setRect({ left: activeEl.offsetLeft, width: activeEl.offsetWidth });
      };

      measure();

      observer = new ResizeObserver(() => {
        if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = requestAnimationFrame(measure);
      });
      observer.observe(container);
    };

    attach();

    return () => {
      if (attachFrameId !== null) cancelAnimationFrame(attachFrameId);
      if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
      observer?.disconnect();
    };
  }, [containerRef, activeId]);

  if (!rect) return null;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-[#d9b98b] transition-[transform,width] duration-300 ease-spring"
      style={{ transform: `translateX(${rect.left}px)`, width: `${rect.width}px` }}
    />
  );
}
