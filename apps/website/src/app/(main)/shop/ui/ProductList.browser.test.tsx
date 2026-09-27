import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, expect, type MockInstance, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  type ProductsPage,
  type ShopSort,
  selectPage,
  shopProductsQueryKey,
  shopSortSchema,
} from "@/lib/shop/pagination";
import { makeShopQueryClient } from "@/lib/shop/query-client";
import type { Product } from "@/lib/shop/schema";

// Same stand-ins as ProductCard.browser.test.tsx: the real `next/link` reaches
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

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { ProductList } from "./ProductList";

// --- Fixture ---

// `product-NN` was added on 2026-01-NN, so newest first is 15 down to 01.
const products: Product[] = Array.from({ length: 15 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
).map((nn, i) => ({
  slug: `product-${nn}`,
  brand: "Test Brand",
  name: `Product ${nn}`,
  price: { amount: 1000 + i, currency: "EUR" },
  description: "A test product.",
  details: "Test details.",
  images: [{ src: "/shop/sample-01.webp", alt: `Product ${nn}`, width: 800, height: 800 }],
  createdAt: `2026-01-${nn}`,
}));

const page1 = selectPage(products, null, 6, "newest");

// --- Doubles ---

/** An IntersectionObserver the test drives by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  disconnect() {
    this.targets.clear();
  }

  unobserve() {}

  takeRecords() {
    return [];
  }

  trigger(isIntersecting: boolean) {
    const entries = [...this.targets].map(
      (target) => ({ isIntersecting, target }) as IntersectionObserverEntry,
    );
    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }
}

const triggerSentinel = () => {
  for (const observer of FakeIntersectionObserver.instances) observer.trigger(true);
};

/** Serves pages from the fixture, the way `GET /api/shop/products` would. */
function servePage(input: RequestInfo | URL): Response {
  const url = new URL(String(input), window.location.origin);
  const cursor = url.searchParams.get("cursor");
  const limit = Number(url.searchParams.get("limit"));
  const sort = shopSortSchema.parse(url.searchParams.get("sort") ?? "newest");
  return Response.json(selectPage(products, cursor, limit, sort));
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  mockCapture.mockClear();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (input) => servePage(input));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchSpy.mockRestore();
});

// --- Helpers ---

/**
 * Newest page one as the server hands it over: dehydrated, then hydrated
 * here. `rerenderWithSort` swaps the list's `sort` inside the same client.
 */
async function renderHydrated() {
  const server = new QueryClient();
  server.setQueryData(shopProductsQueryKey("newest"), { pages: [page1], pageParams: [null] });
  const state = dehydrate(server);

  // The real client, minus TanStack's automatic retries, so a failed page
  // surfaces at once instead of after its backoff.
  const client = makeShopQueryClient();
  client.setQueryDefaults(["shop", "products"], { retry: false });

  const tree = (sort: ShopSort) => (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={state}>
        <Suspense fallback={null}>
          <ProductList sort={sort} />
        </Suspense>
      </HydrationBoundary>
    </QueryClientProvider>
  );

  const screen = await render(tree("newest"));
  return Object.assign(screen, {
    rerenderWithSort: (sort: ShopSort) => screen.rerender(tree(sort)),
  });
}

const articles = (screen: Awaited<ReturnType<typeof renderHydrated>>) =>
  screen.getByRole("article");

// --- Tests ---

test("page one renders from hydrated state without a fetch or a capture", async () => {
  const screen = await renderHydrated();

  await expect.element(articles(screen).nth(5)).toBeVisible();
  expect(articles(screen).all()).toHaveLength(6);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

test("the sentinel loads exactly one next page and reports it", async () => {
  const screen = await renderHydrated();
  await expect.element(articles(screen).nth(5)).toBeVisible();

  triggerSentinel();

  await expect.element(articles(screen).nth(11)).toBeVisible();
  expect(articles(screen).all()).toHaveLength(12);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const url = String(fetchSpy.mock.calls[0][0]);
  expect(url).toContain(`cursor=${page1.nextCursor}`);
  expect(url).toContain("limit=6");
  await expect
    .poll(() => mockCapture.mock.calls)
    .toEqual([["shop_products_page_loaded", { page_index: 1, items: 6 }]]);
});

test("Load more loads exactly one next page", async () => {
  const screen = await renderHydrated();

  await screen.getByRole("button", { name: "Load more" }).click();

  await expect.element(articles(screen).nth(11)).toBeVisible();
  expect(articles(screen).all()).toHaveLength(12);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("after the last page, Load more is gone and the sentinel stops fetching", async () => {
  const screen = await renderHydrated();
  const loadMore = screen.getByRole("button", { name: "Load more" });

  await loadMore.click();
  await expect.element(articles(screen).nth(11)).toBeVisible();
  await loadMore.click();
  await expect.element(articles(screen).nth(14)).toBeVisible();

  await expect.element(loadMore).not.toBeInTheDocument();
  triggerSentinel();
  expect(articles(screen).all()).toHaveLength(15);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("a failed next page shows a retry line and keeps the loaded cards", async () => {
  fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }));
  const screen = await renderHydrated();

  await screen.getByRole("button", { name: "Load more" }).click();

  const alert = screen.getByRole("alert");
  await expect.element(alert).toHaveTextContent("Couldn't load more products.");
  expect(articles(screen).all()).toHaveLength(6);
  expect(mockCapture).not.toHaveBeenCalled();

  await alert.getByRole("button", { name: "Try again" }).click();

  await expect.element(articles(screen).nth(11)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("a skeleton shows below the cards while the next page is in flight", async () => {
  let release: (response: Response) => void = () => {};
  fetchSpy.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const screen = await renderHydrated();

  await screen.getByRole("button", { name: "Load more" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Loading products");
  expect(articles(screen).all()).toHaveLength(6);

  const page2: ProductsPage = selectPage(products, page1.nextCursor, 6, "newest");
  release(Response.json(page2));

  await expect.element(articles(screen).nth(11)).toBeVisible();
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
});

test("switching sort fetches page one of the new order, then pages it with its own cursor", async () => {
  const screen = await renderHydrated();
  await expect.element(articles(screen).nth(5)).toBeVisible();
  expect(fetchSpy).not.toHaveBeenCalled();

  await screen.rerenderWithSort("oldest");

  await expect
    .element(articles(screen).first().getByRole("link", { name: "Product 01", exact: true }))
    .toBeVisible();
  expect(articles(screen).all()).toHaveLength(6);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const firstUrl = new URL(String(fetchSpy.mock.calls[0][0]), window.location.origin);
  expect(firstUrl.searchParams.get("sort")).toBe("oldest");
  expect(firstUrl.searchParams.get("limit")).toBe("6");
  expect(firstUrl.searchParams.has("cursor")).toBe(false);

  await screen.getByRole("button", { name: "Load more" }).click();

  await expect.element(articles(screen).nth(11)).toBeVisible();
  const oldestPage1 = selectPage(products, null, 6, "oldest");
  const nextUrl = new URL(String(fetchSpy.mock.calls[1][0]), window.location.origin);
  expect(nextUrl.searchParams.get("sort")).toBe("oldest");
  expect(nextUrl.searchParams.get("cursor")).toBe(oldestPage1.nextCursor);
});
