import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { RoomSwitcher } from "./RoomSwitcher";

// The real panels are two prerendered <BookingEngine> trees handed down as
// props from the Server Component. Anything renderable stands in for them
// here: the switcher only ever swaps the nodes it is given.
const panels = {
  room1: <p>room one panel</p>,
  room2: <p>room two panel</p>,
};

test("room 1's panel is on screen first and room 2's is not", async () => {
  const { getByText } = await render(<RoomSwitcher {...panels} />);

  await expect.element(getByText("room one panel")).toBeInTheDocument();
  await expect.element(page.getByText("room two panel")).not.toBeInTheDocument();
});

test("clicking the room 2 tab swaps which panel is rendered", async () => {
  const { getByRole, getByText } = await render(<RoomSwitcher {...panels} />);

  await getByRole("tab", { name: "room 2" }).click();

  await expect.element(getByText("room two panel")).toBeInTheDocument();
  await expect.element(page.getByText("room one panel")).not.toBeInTheDocument();
});

test("aria-selected follows the active tab", async () => {
  const { getByRole } = await render(<RoomSwitcher {...panels} />);

  await expect
    .element(getByRole("tab", { name: "room 1" }))
    .toHaveAttribute("aria-selected", "true");
  await expect
    .element(getByRole("tab", { name: "room 2" }))
    .toHaveAttribute("aria-selected", "false");

  await getByRole("tab", { name: "room 2" }).click();

  await expect
    .element(getByRole("tab", { name: "room 1" }))
    .toHaveAttribute("aria-selected", "false");
  await expect
    .element(getByRole("tab", { name: "room 2" }))
    .toHaveAttribute("aria-selected", "true");
});
