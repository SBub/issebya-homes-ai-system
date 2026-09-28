import type { ReactNode } from "react";
import { ShopProviders } from "./ui/ShopProviders";

// No data access and no request APIs, so every shop route under it stays
// prerendered.
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <ShopProviders>{children}</ShopProviders>;
}
