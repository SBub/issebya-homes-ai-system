"use client";

import { useRef } from "react";
import posthog from "posthog-js";
import { TabIndicator } from "./TabIndicator";
import { TabLink } from "./TabLink";

export interface Tab {
  id: string;
  label: string;
  href: string;
}

interface TabsMobileProps {
  tabs: Tab[];
  activeTabId: string;
}

export function TabsMobile({ tabs, activeTabId }: TabsMobileProps) {
  const widthClass = tabs.length === 2 ? "w-1/2" : tabs.length === 3 ? "w-1/3" : "flex-1";
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div className="order-1 w-full md:hidden">
      <div ref={listRef} className="relative flex border-b w-full">
        <TabIndicator containerRef={listRef} activeId={activeTabId} />
        {tabs.map((tab, index) => {
          const isLast = index === tabs.length - 1;
          return (
            <TabLink
              key={tab.id}
              href={tab.href}
              tabId={tab.id}
              onClick={() => {
                if (tab.id !== activeTabId) {
                  posthog.capture("room_tab_clicked", { room_type: tab.id });
                }
              }}
              className={`${widthClass} px-3 py-1.5 text-center ${!isLast ? "border-r border-black" : ""}`}
            >
              {tab.label}
            </TabLink>
          );
        })}
      </div>
    </div>
  );
}
