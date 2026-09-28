"use client";

import { ErrorBoundary } from "@sentry/nextjs";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, startTransition } from "react";
import { ShopGridError } from "./ShopGridError";

/**
 * The `/shop` grid's error boundary, so a failed page one degrades to a
 * message inside the products section instead of blanking the route.
 *
 * A client wrapper because the fallback render prop and `beforeCapture` are
 * functions, which the server `page.tsx` cannot pass to Sentry's client
 * `ErrorBoundary`. It sits outside the grid's `<Suspense>` so it catches a
 * throw from anything under it, and the page passes its server children
 * through as `children`.
 *
 * Page one can fail in two places, and "Try again" has to recover both:
 * - on the client, when the suspense query rejects. React Query keeps the
 *   query in its error state and would re-throw it on remount, so `onReset`
 *   clears its error reset boundary and the query refetches.
 * - on the server, when `ShopProducts` throws. Resetting alone re-renders the
 *   same errored RSC chunk, so `router.refresh()` re-requests the payload in
 *   the same transition (what Next's own `unstable_retry` does).
 *
 * Next-page failures never reach it: in suspense mode they do not throw while
 * data exists, and `ProductList` shows its own retry line for them.
 */
export function ShopGridBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      beforeCapture={(scope) => {
        scope.setTag("area", "shop");
        scope.setTag("surface", "product-grid");
      }}
      onReset={reset}
      fallback={({ resetError }) => (
        <ShopGridError
          onRetry={() =>
            startTransition(() => {
              router.refresh();
              resetError();
            })
          }
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
