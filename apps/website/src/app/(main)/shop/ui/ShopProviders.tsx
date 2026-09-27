"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { makeShopQueryClient } from "@/lib/shop/query-client";

/**
 * The shop's query cache. Mounted by the shop layout, so loaded pages survive
 * navigating to a product and back. One client per browser session: the lazy
 * `useState` initialiser keeps re-renders from creating a new one.
 */
export function ShopProviders({ children }: { children: ReactNode }) {
  const [client] = useState(makeShopQueryClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
