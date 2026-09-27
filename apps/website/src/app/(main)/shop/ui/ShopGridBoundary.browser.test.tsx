import { QueryClientProvider } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, expect, type MockInstance, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SHOP_PRODUCTS_QUERY_KEY, selectPage } from "@/lib/shop/pagination";
import { makeShopQueryClient } from "@/lib/shop/query-client";
import type { Product } from "@/lib/shop/schema";
import { SELL_LINK_LABEL } from "@/lib/shop/seller-submission";

// Same stand-ins as ProductList.browser.test.tsx: the real `next/link` reaches
// for `process` at import time, and `next/image` is not under test.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

// The real `@sentry/nextjs` client entry imports `next/router`, which reads
// `process` at import time. Its `ErrorBoundary` is a re-export of
// `@sentry/react`'s, so the boundary under test is still Sentry's own.
vi.mock("@sentry/nextjs", async () => {
  const { ErrorBoundary } = await import("@sentry/react");
  return { ErrorBoundary };
});

// The real `ShopProducts` pulls in `next/cache`. This one throws while the
// test says so, standing in for a first-page error from `ProductList`.
const grid = vi.hoisted(() => ({ shouldThrow: true }));
vi.mock("./ShopProducts", () => ({
  ShopProducts: () => {
    if (grid.shouldThrow) throw new Error("page one failed");
    return <p>Grid loaded</p>;
  },
}));

import ShopIndexPage from "../page";
import { ProductList } from "./ProductList";
import { ShopGridBoundary } from "./ShopGridBoundary";

const FALLBACK_COPY = "The shop did not load. Please try again in a moment, or reach us on";

const products: Product[] = Array.from({ length: 6 }, (_, i) => ({
  slug: `product-${i}`,
  brand: "Test Brand",
  name: `Product ${i}`,
  price: { amount: 1000 + i, currency: "EUR" },
  description: "A test product.",
  details: "Test details.",
  images: [{ src: "/shop/sample-01.webp", alt: `Product ${i}`, width: 800, height: 800 }],
}));

let consoleSpy: MockInstance<typeof console.error>;

// React and Sentry both log the errors these tests throw on purpose.
beforeEach(() => {
  grid.shouldThrow = true;
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

test("a failed grid shows the fallback inside Products, and the sell link survives", async () => {
  const screen = await render(<ShopIndexPage />);
  const region = screen.getByRole("region", { name: "Products" });

  await expect.element(region).toHaveTextContent(FALLBACK_COPY);
  await expect
    .element(region.getByRole("link", { name: "WhatsApp (+351 920 742 845)" }))
    .toHaveAttribute("href", "https://wa.me/351920742845");
  await expect.element(region.getByRole("button", { name: "Try again" })).toBeVisible();

  const sell = screen.getByRole("link", { name: SELL_LINK_LABEL });
  await expect.element(sell).toHaveAttribute("href", "/shop/sell");
  expect(region.element().contains(sell.element())).toBe(false);
});

test("Try again re-renders the grid in place", async () => {
  const screen = await render(<ShopIndexPage />);
  await expect.element(screen.getByText(FALLBACK_COPY)).toBeVisible();

  grid.shouldThrow = false;
  await screen.getByRole("button", { name: "Try again" }).click();

  await expect.element(screen.getByText("Grid loaded")).toBeVisible();
  await expect.element(screen.getByText(FALLBACK_COPY)).not.toBeInTheDocument();
});

test("Try again refetches a failed suspense query and shows the products", async () => {
  const fetchSpy = vi
    .spyOn(window, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json(selectPage(products, null, 6)));

  // The real client, minus TanStack's automatic retries, with no hydrated
  // page one: the list has to fetch it, and that first fetch fails.
  const client = makeShopQueryClient();
  client.setQueryDefaults(SHOP_PRODUCTS_QUERY_KEY, { retry: false });

  try {
    const screen = await render(
      <QueryClientProvider client={client}>
        <ShopGridBoundary>
          <Suspense fallback={<p>loading</p>}>
            <ProductList />
          </Suspense>
        </ShopGridBoundary>
      </QueryClientProvider>,
    );
    await expect.element(screen.getByText(FALLBACK_COPY)).toBeVisible();

    await screen.getByRole("button", { name: "Try again" }).click();

    await expect.element(screen.getByRole("article").nth(5)).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  } finally {
    fetchSpy.mockRestore();
  }
});
