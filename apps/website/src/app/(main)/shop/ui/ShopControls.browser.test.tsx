import { createContext, Suspense, use, useEffect, useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { shopParamsFromSearch } from "@/lib/shop/pagination";

// --- Mocks ---

// The router is not under test. `navigate` lets the harness below play the
// part of the server render that follows a URL change. The URL is state the
// harness provides through a context, not a module variable: the navigation
// runs inside `ShopControls`' transition, and until it commits the component
// must keep reading the old URL.
const SearchContext = createContext(new URLSearchParams());
let navigate: (href: string) => void = () => {};
const mockReplace = vi.fn((href: string, _options?: { scroll: boolean }) => navigate(href));
const mockPush = vi.fn((href: string, _options?: { scroll: boolean }) => navigate(href));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => "/shop",
  useSearchParams: () => use(SearchContext),
}));

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { ShopControls } from "./ShopControls";
import { ShopResults } from "./ShopResults";

// --- Harness ---

/** Terms whose cards suspend until the test resolves them. */
const gates = new Map<string, PromiseWithResolvers<void>>();

function gate(term: string): PromiseWithResolvers<void> {
  const resolvers = Promise.withResolvers<void>();
  gates.set(term, resolvers);
  return resolvers;
}

/** Stand-in for the hydrated product list: two cards per term. */
function Cards({ q }: { q: string }) {
  const pending = gates.get(q);
  if (pending) use(pending.promise);

  const label = q === "" ? "all" : q;
  return (
    <>
      <article>{`${label} 1`}</article>
      <article>{`${label} 2`}</article>
    </>
  );
}

/**
 * `/shop` in miniature: the controls' Suspense boundary, and inside them the
 * list's, around the results and the cards, with the URL read back from
 * wherever the controls navigate to. The navigation runs inside
 * `ShopControls`'s transition, so this state update is part of it.
 */
function Harness({ initialSearch = "" }: { initialSearch?: string }) {
  const [params, setParams] = useState(() => new URLSearchParams(initialSearch));
  const { q } = shopParamsFromSearch(params);

  useEffect(() => {
    navigate = (href) => setParams(new URL(href, window.location.origin).searchParams);
  }, []);

  return (
    <SearchContext value={params}>
      <Suspense fallback={<div data-testid="skeleton" />}>
        <ShopControls>
          <Suspense fallback={<div data-testid="skeleton" />}>
            <ShopResults q={q} total={q === "" ? 15 : 3}>
              <Cards q={q} />
            </ShopResults>
          </Suspense>
        </ShopControls>
      </Suspense>
    </SearchContext>
  );
}

const searchbox = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("searchbox", { name: "Search products" });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  navigate = () => {};
  gates.clear();
  mockReplace.mockClear();
  mockPush.mockClear();
  mockCapture.mockClear();
});

// --- Tests ---

test("typing shows every key at once and replaces the URL once, after a pause", async () => {
  const screen = await render(<Harness />);

  await searchbox(screen).click();
  await userEvent.keyboard("l");
  await expect.element(searchbox(screen)).toHaveValue("l");
  expect(mockReplace).not.toHaveBeenCalled();
  await userEvent.keyboard("am");

  await expect.poll(() => mockReplace.mock.calls).toEqual([["/shop?q=lam", { scroll: false }]]);
  await wait(400);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

test("Enter applies the term at once, and the debounce does not apply it again", async () => {
  const screen = await render(<Harness />);

  await searchbox(screen).click();
  await userEvent.keyboard("lam{Enter}");

  await expect.poll(() => mockReplace.mock.calls).toEqual([["/shop?q=lam", { scroll: false }]]);
  await wait(400);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

test("Escape empties the box and returns to /shop at once", async () => {
  const screen = await render(<Harness initialSearch="q=lam" />);
  await expect.element(searchbox(screen)).toHaveValue("lam");

  await searchbox(screen).click();
  await userEvent.keyboard("{Escape}");

  await expect.element(searchbox(screen)).toHaveValue("");
  await expect.poll(() => mockReplace.mock.calls).toEqual([["/shop", { scroll: false }]]);
});

test("deleting every character returns to /shop without waiting for the debounce", async () => {
  const screen = await render(<Harness initialSearch="q=la" />);

  await searchbox(screen).click();
  await userEvent.keyboard("{End}{Backspace}{Backspace}");

  await expect.poll(() => mockReplace.mock.calls).toEqual([["/shop", { scroll: false }]]);
});

test("a search keeps the sort", async () => {
  const screen = await render(<Harness initialSearch="sort=oldest" />);

  await searchbox(screen).click();
  await userEvent.keyboard("teen");

  await expect
    .poll(() => mockReplace.mock.calls)
    .toEqual([["/shop?sort=oldest&q=teen", { scroll: false }]]);
});

test("a sort change keeps the search and reports the sort", async () => {
  const screen = await render(<Harness initialSearch="sort=oldest&q=teen" />);

  await screen.getByLabelText("Sort").selectOptions("Newest first");

  await expect.poll(() => mockPush.mock.calls).toEqual([["/shop?q=teen", { scroll: false }]]);
  expect(mockCapture).toHaveBeenCalledExactlyOnceWith("shop_sort_changed", { sort: "newest" });
  expect(mockReplace).not.toHaveBeenCalled();
});

test("while a search loads, the previous cards stay, dimmed and busy, with no skeleton", async () => {
  const screen = await render(<Harness />);
  const grid = screen.getByTestId("shop-grid");
  await expect.element(screen.getByText("all 1")).toBeVisible();
  await expect.element(grid).not.toHaveAttribute("aria-busy");
  const lam = gate("lam");

  await searchbox(screen).click();
  await userEvent.keyboard("lam{Enter}");

  await expect.element(grid).toHaveAttribute("aria-busy", "true");
  await expect.element(grid).toHaveClass("opacity-50");
  expect(screen.getByRole("article").all()).toHaveLength(2);
  await expect.element(screen.getByText("all 1")).toBeInTheDocument();
  await expect.element(screen.getByTestId("skeleton")).not.toBeInTheDocument();

  lam.resolve();

  await expect.element(screen.getByText("lam 1")).toBeVisible();
  await expect.element(grid).not.toHaveAttribute("aria-busy");
  await expect.element(grid).not.toHaveClass("opacity-50");
});

test("Escape while a search is loading still returns to /shop", async () => {
  const screen = await render(<Harness />);
  await expect.element(screen.getByText("all 1")).toBeVisible();
  gate("lam");

  await searchbox(screen).click();
  await userEvent.keyboard("lam{Enter}");
  await expect.element(screen.getByTestId("shop-grid")).toHaveAttribute("aria-busy", "true");
  await userEvent.keyboard("{Escape}");

  await expect.element(searchbox(screen)).toHaveValue("");
  await expect
    .poll(() => mockReplace.mock.calls)
    .toEqual([
      ["/shop?q=lam", { scroll: false }],
      ["/shop", { scroll: false }],
    ]);
  await expect.element(screen.getByText("all 1")).toBeVisible();
});

test("reads sort and q from the URL", async () => {
  const screen = await render(<Harness initialSearch="sort=oldest&q=silver" />);

  await expect.element(screen.getByLabelText("Sort")).toHaveValue("oldest");
  await expect.element(searchbox(screen)).toHaveValue("silver");
});

test("a malformed URL shows the defaults", async () => {
  const screen = await render(<Harness initialSearch="sort=bogus&q=a&q=b" />);

  await expect.element(screen.getByLabelText("Sort")).toHaveValue("newest");
  await expect.element(searchbox(screen)).toHaveValue("");
});

test("a URL change from elsewhere resets the box", async () => {
  const screen = await render(<Harness initialSearch="q=teen" />);
  await expect.element(searchbox(screen)).toHaveValue("teen");

  navigate("/shop");

  await expect.element(searchbox(screen)).toHaveValue("");
  await expect.element(screen.getByText("all 1")).toBeVisible();
  expect(mockReplace).not.toHaveBeenCalled();
});
