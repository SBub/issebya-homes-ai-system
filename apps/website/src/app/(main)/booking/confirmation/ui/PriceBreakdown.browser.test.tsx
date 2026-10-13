import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { PriceBreakdown } from "./PriceBreakdown";

test("a stay with no tourist tax (a lock-in week) shows no tourist tax row", async () => {
  const screen = await render(<PriceBreakdown basePrice={525} touristTax={0} total={525} />);

  await expect.element(screen.getByText("Room price")).toBeInTheDocument();
  await expect.element(screen.getByText("Tourist tax")).not.toBeInTheDocument();
  await expect.element(screen.getByText("Total")).toBeInTheDocument();
});

test("a nightly stay shows its tourist tax row", async () => {
  const screen = await render(<PriceBreakdown basePrice={225} touristTax={6} total={231} />);

  await expect.element(screen.getByText("Tourist tax")).toBeInTheDocument();
  await expect.element(screen.getByText("€6")).toBeInTheDocument();
});
