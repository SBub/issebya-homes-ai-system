import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

// The live controls read the URL and drive the router; neither is under test,
// only the box the row takes up.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/shop",
  useSearchParams: () => new URLSearchParams("sort=oldest&q=silver"),
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { ShopControls } from "./ShopControls";
import { ShopControlsFallback } from "./ShopControlsFallback";

/** The products section's horizontal padding, around a fixed-height grid. */
function Section({ children }: { children: ReactNode }) {
  return <section className="bg-shop-ground px-4 md:px-12 w-full">{children}</section>;
}

const Grid = () => <div data-testid="grid-slot" style={{ height: 200 }} />;

test.each([
  [390, 104],
  [490, 104],
  [505, 44],
  [1280, 44],
])("at %i px the fallback row and the live row take the same box", async (width, minHeight) => {
  await page.viewport(width, 800);
  const screen = await render(
    <>
      <div data-testid="fallback">
        <Section>
          <ShopControlsFallback>
            <Grid />
          </ShopControlsFallback>
        </Section>
      </div>
      <div data-testid="live">
        <Section>
          <ShopControls>
            <Grid />
          </ShopControls>
        </Section>
      </div>
    </>,
  );
  const fallback = screen.getByTestId("fallback");
  const live = screen.getByTestId("live");
  await expect.element(live.getByRole("searchbox")).toHaveValue("silver");

  const row = (root: typeof fallback) => {
    const section = root.element().querySelector("section");
    if (!section?.firstElementChild) throw new Error("no controls row");
    return section.firstElementChild as HTMLElement;
  };
  const slot = (root: typeof fallback) => root.getByTestId("grid-slot").element() as HTMLElement;
  const slotOffset = (root: typeof fallback) =>
    slot(root).getBoundingClientRect().top - root.element().getBoundingClientRect().top;

  expect(row(fallback).offsetHeight).toBe(row(live).offsetHeight);
  expect(row(fallback).offsetHeight).toBeGreaterThanOrEqual(minHeight);
  expect(slotOffset(fallback)).toBe(slotOffset(live));

  for (const root of [fallback, live]) {
    const search = root.getByRole("searchbox").element().getBoundingClientRect();
    const sort = root.getByLabelText("Sort").element().getBoundingClientRect();
    expect(search.height).toBe(44);
    expect(sort.height).toBe(search.height);
    if (minHeight === 44) {
      expect(Math.abs(sort.top + sort.height / 2 - (search.top + search.height / 2))).toBeLessThan(
        0.5,
      );
    }
  }

  await expect.element(fallback.getByRole("searchbox", { name: "Search products" })).toBeDisabled();
  await expect.element(fallback.getByLabelText("Sort")).toBeDisabled();
  await expect.element(live.getByRole("searchbox", { name: "Search products" })).toBeEnabled();
});
