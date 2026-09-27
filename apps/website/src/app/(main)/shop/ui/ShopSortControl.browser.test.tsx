import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The control only writes the URL; the router is not under test.
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/shop",
}));

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { ShopSortControl } from "./ShopSortControl";

beforeEach(() => {
  mockPush.mockClear();
  mockCapture.mockClear();
});

test("shows the sort it was given", async () => {
  const screen = await render(<ShopSortControl sort="newest" />);

  await expect.element(screen.getByLabelText("Sort")).toHaveValue("newest");
  await expect
    .element(screen.getByRole("option", { name: "Newest first" }))
    .toHaveProperty("selected", true);
});

test("choosing Oldest first puts the sort in the URL and reports it", async () => {
  const screen = await render(<ShopSortControl sort="newest" />);

  await screen.getByLabelText("Sort").selectOptions("Oldest first");

  expect(mockPush).toHaveBeenCalledExactlyOnceWith("/shop?sort=oldest", { scroll: false });
  expect(mockCapture).toHaveBeenCalledExactlyOnceWith("shop_sort_changed", { sort: "oldest" });
});

test("choosing Newest first returns to the clean /shop URL", async () => {
  const screen = await render(<ShopSortControl sort="oldest" />);

  await screen.getByLabelText("Sort").selectOptions("Newest first");

  expect(mockPush).toHaveBeenCalledExactlyOnceWith("/shop", { scroll: false });
  expect(mockCapture).toHaveBeenCalledExactlyOnceWith("shop_sort_changed", { sort: "newest" });
});
