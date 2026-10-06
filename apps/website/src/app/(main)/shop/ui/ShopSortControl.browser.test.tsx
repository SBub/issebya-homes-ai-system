import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ShopSortControl } from "./ShopSortControl";

test("shows the sort it was given", async () => {
  const screen = await render(<ShopSortControl value="newest" onChange={vi.fn()} busy={false} />);

  await expect.element(screen.getByLabelText("Sort")).toHaveValue("newest");
  await expect
    .element(screen.getByRole("option", { name: "Newest first" }))
    .toHaveProperty("selected", true);
});

test("choosing Oldest first reports it once", async () => {
  const onChange = vi.fn();
  const screen = await render(<ShopSortControl value="newest" onChange={onChange} busy={false} />);

  await screen.getByLabelText("Sort").selectOptions("Oldest first");

  expect(onChange).toHaveBeenCalledExactlyOnceWith("oldest");
});

test("busy marks the select", async () => {
  const screen = await render(<ShopSortControl value="newest" onChange={vi.fn()} busy />);

  await expect.element(screen.getByLabelText("Sort")).toHaveAttribute("aria-busy", "true");
});

test("the sort select draws no native widget", async () => {
  const screen = await render(<ShopSortControl value="newest" onChange={vi.fn()} busy={false} />);

  const select = screen.getByLabelText("Sort").element() as HTMLSelectElement;
  expect(select.tagName).toBe("SELECT");
  expect(getComputedStyle(select).appearance).toBe("none");
  expect(select.offsetHeight).toBe(44);
  expect(select.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
});
