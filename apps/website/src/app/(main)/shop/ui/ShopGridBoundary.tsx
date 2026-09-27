"use client";

import { ErrorBoundary } from "@sentry/nextjs";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ShopGridError } from "./ShopGridError";

/**
 * Catches a first-page failure of the `/shop` grid, so it replaces only the
 * Products section instead of blanking the route. Next-page failures never
 * reach it: `ProductList` handles those itself with its retry line.
 *
 * A Client Component wrapper rather than an inline `<ErrorBoundary>` in
 * `page.tsx`: the page is a Server Component, and it cannot pass functions
 * (the fallback render prop, `beforeCapture`) across to a Client Component.
 * The server subtree still arrives through `children`.
 *
 * `onReset={reset}`: a suspense query that has failed rethrows its cached
 * error on re-mount until its `QueryErrorResetBoundary` is reset. Without
 * this, "Try again" would re-mount the grid straight back into the fallback.
 */
export function ShopGridBoundary({ children }: { children: ReactNode }) {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      onReset={reset}
      beforeCapture={(scope) => {
        scope.setTag("area", "shop");
        scope.setTag("surface", "product-grid");
      }}
      fallback={({ resetError }) => <ShopGridError onRetry={resetError} />}
    >
      {children}
    </ErrorBoundary>
  );
}
