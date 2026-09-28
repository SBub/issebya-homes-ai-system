import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, expect, type MockInstance, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { makeShopQueryClient } from "@/lib/shop/query-client";

// --- Mocks ---

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// `@sentry/nextjs` pulls in Next's pages router, which reads `process` at
// import time. Its client entry re-exports `@sentry/react` wholesale (pinned to
// the same version as the devDependency), so this is the ErrorBoundary the page ships.
vi.mock("@sentry/nextjs", async () => {
  const { ErrorBoundary } = await import("@sentry/react");
  return { ErrorBoundary };
});

// WhatsAppLink captures a click event; analytics is not under test.
vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

import { ShopGridBoundary } from "./ShopGridBoundary";

// --- Harness ---

const FALLBACK_COPY = "The shop did not load. Please try again in a moment, or reach us on";

/** `/shop` in miniature: the products section around the boundary, the sell line outside it. */
function renderShop(grid: ReactNode) {
  return render(
    <QueryClientProvider client={makeShopQueryClient()}>
      <section aria-label="Products">
        <ShopGridBoundary>
          <Suspense fallback={<p>Loading products</p>}>{grid}</Suspense>
        </ShopGridBoundary>
      </section>
      <p>Have something to sell?</p>
    </QueryClientProvider>,
  );
}

function AlwaysThrows(): ReactNode {
  throw new Error("page one failed");
}

// Flipped by the test, not by the first throw: React re-renders once on its
// own after a concurrent render error, which would otherwise recover the child
// before the boundary ever showed.
let pageOneFails = true;

/** Fails until the test lets page one load, like a transient outage. */
function FailsUntilFixed() {
  if (pageOneFails) throw new Error("page one failed");
  return <p>Products loaded</p>;
}

let queryCalls = 0;

/** A suspense query whose first fetch rejects and whose second resolves. */
function FailsFirstQuery() {
  const { data } = useSuspenseQuery({
    queryKey: ["shop-grid-boundary-test"],
    queryFn: async () => {
      queryCalls += 1;
      if (queryCalls === 1) throw new Error("page one failed");
      return "Products loaded";
    },
    retry: false,
  });
  return <p>{data}</p>;
}

// React logs every error a boundary catches; these throws are the point of the test.
let consoleError: MockInstance;

beforeEach(() => {
  pageOneFails = true;
  queryCalls = 0;
  mockRefresh.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

// --- Tests ---

test("a throwing grid degrades to the message and keeps the sell link", async () => {
  const screen = await renderShop(<AlwaysThrows />);

  await expect.element(screen.getByText(FALLBACK_COPY)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "WhatsApp (+351 920 742 845)" }))
    .toHaveAttribute("href", "https://wa.me/351920742845");
  await expect.element(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect.element(screen.getByText("Have something to sell?")).toBeVisible();
});

test("Try again re-renders the grid", async () => {
  const screen = await renderShop(<FailsUntilFixed />);

  await expect.element(screen.getByText(FALLBACK_COPY)).toBeVisible();
  pageOneFails = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));

  await expect.element(screen.getByText("Products loaded")).toBeVisible();
  await expect.element(screen.getByText(FALLBACK_COPY)).not.toBeInTheDocument();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test("a failed suspense query recovers on retry", async () => {
  const screen = await renderShop(<FailsFirstQuery />);

  await expect.element(screen.getByText(FALLBACK_COPY)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));

  await expect.element(screen.getByText("Products loaded")).toBeVisible();
  expect(queryCalls).toBe(2);
});
