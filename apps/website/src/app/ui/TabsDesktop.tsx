"use client";

import { trackTabClicked } from "@/lib/analytics";
import { TabLink } from "./TabLink";

export interface Tab {
  id: string;
  label: string;
  href: string;
}

interface TabsDesktopProps {
  tabs: Tab[];
  activeTabId: string;
  page: string;
}

export function TabsDesktop({ tabs, activeTabId, page }: TabsDesktopProps) {
  return (
    <div className="hidden md:block mb-6">
      <div className="flex border-b">
        {tabs.map((tab, index) => {
          const isLast = index === tabs.length - 1;
          return (
            <TabLink
              key={tab.id}
              href={tab.href}
              isActive={activeTabId === tab.id}
              onClick={() => trackTabClicked(page, tab.id)}
              className={`px-6 py-2 text-base ${!isLast ? "border-r border-black" : ""}`}
            >
              {tab.label}
            </TabLink>
          );
        })}
      </div>
    </div>
  );
}
