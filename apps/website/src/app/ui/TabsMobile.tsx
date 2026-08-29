"use client";

import posthog from "posthog-js";
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

  return (
    <div className="order-1 w-full md:hidden">
      <div className="flex border-b w-full">
        {tabs.map((tab, index) => {
          const isLast = index === tabs.length - 1;
          return (
            <TabLink
              key={tab.id}
              href={tab.href}
              isActive={activeTabId === tab.id}
              onClick={() => {
                if (tab.id !== activeTabId) {
                  posthog.capture("room_tab_clicked", { room_type: tab.id });
                }
              }}
              className={`${widthClass} px-3 py-1.5 text-sm text-center ${!isLast ? "border-r border-black" : ""}`}
            >
              {tab.label}
            </TabLink>
          );
        })}
      </div>
    </div>
  );
}
