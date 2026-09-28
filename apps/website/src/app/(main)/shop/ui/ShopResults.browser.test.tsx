import { createContext, Suspense, use, useEffect, useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { shopParamsFromSearch } from "@/lib/shop/pagination";

// --- Mocks ---

// Same harness idea as ShopControls.browser.test.tsx: the URL is state the
// harness provides through a context, and `navigate` plays the part of the
// server render that follows a URL change.
let navigate: (href: string) => void = () => {};
const SearchContext = createContext(new URLSearchParams());
const mockReplace = vi.fn((href: string, _options?: { scroll: boolean }) => navigate(href));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
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

/** Match counts: everything for no term, none for "lamp", three otherwise. */
const totalFor = (q: string) => (q === "" ? 15 : q === "lamp" ? 0 : 3);

/** `ShopResults` inside a real `ShopControls`, as `/shop` renders them. */
function Harness({ initialSearch = "" }: { initialSearch?: string }) {
  const [params, setParams] = useState(() => new URLSearchParams(initialSearch));
  const { q } = shopParamsFromSearch(params);

  useEffect(() => {
    navigate = (href) => setParams(new URL(href, window.location.origin).searchParams);
  }, []);

  const label = q === "" ? "all" : q;
  return (
    <SearchContext value={params}>
      <Suspense>
        <ShopControls>
          <ShopResults q={q} total={totalFor(q)}>
            <article>{`${label} 1`}</article>
          </ShopResults>
        </ShopControls>
      </Suspense>
    </SearchContext>
  );
}

const searchbox = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("searchbox", { name: "Search products" });

beforeEach(() => {
  navigate = () => {};
  mockReplace.mockClear();
  mockCapture.mockClear();
});

// --- Tests ---

test("a term with no matches shows the empty message, and Clear returns to /shop", async () => {
  const screen = await render(<Harness initialSearch="q=lamp" />);

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent('Nothing matches "lamp". Try another word or clear the search.');
  await expect.element(screen.getByRole("article")).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Clear" }).click();

  await expect.element(searchbox(screen)).toHaveValue("");
  await expect.poll(() => mockReplace.mock.calls).toEqual([["/shop", { scroll: false }]]);
  await expect.element(screen.getByText("all 1")).toBeVisible();
});

test("reports an applied term once, with its match count", async () => {
  const screen = await render(<Harness />);

  await searchbox(screen).click();
  await userEvent.keyboard("teen");

  await expect.element(screen.getByText("teen 1")).toBeVisible();
  await expect
    .poll(() => mockCapture.mock.calls)
    .toEqual([["shop_search_applied", { length: 4, results: 3 }]]);

  await userEvent.keyboard("{Escape}");

  await expect.element(screen.getByText("all 1")).toBeVisible();
  expect(mockCapture).toHaveBeenCalledTimes(1);
});

test("a shared search link reports nothing on its first render", async () => {
  const screen = await render(<Harness initialSearch="q=teen" />);

  await expect.element(screen.getByText("teen 1")).toBeVisible();
  await expect.element(searchbox(screen)).toHaveValue("teen");
  expect(mockCapture).not.toHaveBeenCalled();
});
