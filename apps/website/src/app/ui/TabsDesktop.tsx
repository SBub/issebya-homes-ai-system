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

interface TabsDesktopProps {
  tabs: Tab[];
  activeTabId: string;
}

export function TabsDesktop({ tabs, activeTabId }: TabsDesktopProps) {
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div className="hidden md:block mb-6">
      <div ref={listRef} className="relative flex border-b">
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
              className={`px-6 py-2 ${!isLast ? "border-r border-black" : ""}`}
            >
              {tab.label}
            </TabLink>
          );
        })}
      </div>
    </div>
  );
}
