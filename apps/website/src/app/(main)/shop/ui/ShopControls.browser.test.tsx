import { Suspense, use, useEffect, useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ShopSort } from "@/lib/shop/pagination";

// --- Mocks ---

// The router is not under test. `navigate` lets the harness below play the
// part of the server render that follows a URL change.
let navigate: (href: string) => void = () => {};
const mockReplace = vi.fn((href: string, _options?: { scroll: boolean }) => navigate(href));
const mockPush = vi.fn((href: string, _options?: { scroll: boolean }) => navigate(href));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => "/shop",
}));

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { ShopControls } from "./ShopControls";

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
 * `/shop` in miniature: the page's Suspense boundary around the controls and
 * the cards, with `q` read back from whatever URL the controls navigate to.
 * The navigation runs inside `ShopControls`'s transition, so this state
 * update is part of it.
 */
function Harness({ initialQ = "", sort = "newest" }: { initialQ?: string; sort?: ShopSort }) {
  const [q, setQ] = useState(initialQ);

  useEffect(() => {
    navigate = (href) => setQ(new URL(href, window.location.origin).searchParams.get("q") ?? "");
  }, []);

  return (
    <Suspense fallback={<div data-testid="skeleton" />}>
      <ShopControls sort={sort} q={q} total={q === "" ? 15 : 3}>
        <Cards q={q} />
      </ShopControls>
    </Suspense>
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

  expect(mockReplace).toHaveBeenCalledExactlyOnceWith("/shop?q=lam", { scroll: false });
  await wait(400);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

test("Escape empties the box and returns to /shop at once", async () => {
  const screen = await render(<Harness initialQ="lam" />);
  await expect.element(searchbox(screen)).toHaveValue("lam");

  await searchbox(screen).click();
  await userEvent.keyboard("{Escape}");

  await expect.element(searchbox(screen)).toHaveValue("");
  expect(mockReplace).toHaveBeenCalledExactlyOnceWith("/shop", { scroll: false });
});

test("deleting every character returns to /shop without waiting for the debounce", async () => {
  const screen = await render(<Harness initialQ="la" />);

  await searchbox(screen).click();
  await userEvent.keyboard("{End}{Backspace}{Backspace}");

  expect(mockReplace).toHaveBeenCalledExactlyOnceWith("/shop", { scroll: false });
});

test("a search keeps the sort", async () => {
  const screen = await render(<Harness sort="oldest" />);

  await searchbox(screen).click();
  await userEvent.keyboard("teen");

  await expect
    .poll(() => mockReplace.mock.calls)
    .toEqual([["/shop?sort=oldest&q=teen", { scroll: false }]]);
});

test("a sort change keeps the search and reports the sort", async () => {
  const screen = await render(<Harness initialQ="teen" sort="oldest" />);

  await screen.getByLabelText("Sort").selectOptions("Newest first");

  expect(mockPush).toHaveBeenCalledExactlyOnceWith("/shop?q=teen", { scroll: false });
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

test("a term with no matches shows the empty message, and Clear returns to /shop", async () => {
  const screen = await render(
    <ShopControls sort="newest" q="lamp" total={0}>
      <article>card</article>
    </ShopControls>,
  );

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent('Nothing matches "lamp". Try another word or clear the search.');
  await expect.element(screen.getByRole("article")).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Clear" }).click();

  await expect.element(searchbox(screen)).toHaveValue("");
  expect(mockReplace).toHaveBeenCalledExactlyOnceWith("/shop", { scroll: false });
});

test("reports an applied term once, with its match count", async () => {
  const screen = await render(<Harness />);

  await searchbox(screen).click();
  await userEvent.keyboard("teen");

  await expect.element(screen.getByText("teen 1")).toBeVisible();
  expect(mockCapture.mock.calls).toEqual([["shop_search_applied", { length: 4, results: 3 }]]);

  await userEvent.keyboard("{Escape}");

  await expect.element(screen.getByText("all 1")).toBeVisible();
  expect(mockCapture).toHaveBeenCalledTimes(1);
});

test("a shared search link reports nothing on its first render", async () => {
  const screen = await render(<Harness initialQ="teen" />);

  await expect.element(screen.getByText("teen 1")).toBeVisible();
  await expect.element(searchbox(screen)).toHaveValue("teen");
  expect(mockCapture).not.toHaveBeenCalled();
});

test("a URL change from elsewhere resets the box", async () => {
  const screen = await render(<Harness initialQ="teen" />);
  await expect.element(searchbox(screen)).toHaveValue("teen");

  navigate("/shop");

  await expect.element(searchbox(screen)).toHaveValue("");
  await expect.element(screen.getByText("all 1")).toBeVisible();
  expect(mockReplace).not.toHaveBeenCalled();
});
