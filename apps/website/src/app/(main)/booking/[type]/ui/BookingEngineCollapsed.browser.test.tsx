import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Mock BookingPricing — child component
vi.mock("./BookingPricing", () => ({
  BookingPricing: function MockPricing() {
    return <div data-testid="mock-pricing">Mock Pricing</div>;
  },
}));

import { BookingEngineCollapsed } from "./BookingEngineCollapsed";

test("user sees formatted dates when provided", async () => {
  const { getByText } = await render(
    <BookingEngineCollapsed
      checkInDate={new Date("2025-08-01")}
      checkOutDate={new Date("2025-08-04")}
      onExpand={vi.fn()}
    />,
  );

  await expect.element(getByText("1 Aug 2025")).toBeInTheDocument();
  await expect.element(getByText("4 Aug 2025")).toBeInTheDocument();
});

test('user sees "Select date" placeholders when no dates', async () => {
  const { getByLabelText } = await render(
    <BookingEngineCollapsed checkInDate={null} checkOutDate={null} onExpand={vi.fn()} />,
  );

  await expect.element(getByLabelText("Select check-in date")).toHaveTextContent("Select date");
  await expect.element(getByLabelText("Select check-out date")).toHaveTextContent("Select date");
});

test("all three buttons are clickable and accessible", async () => {
  const { getByLabelText } = await render(
    <BookingEngineCollapsed checkInDate={null} checkOutDate={null} onExpand={vi.fn()} />,
  );

  await expect.element(getByLabelText("Select check-in date")).toBeEnabled();
  await expect.element(getByLabelText("Select check-out date")).toBeEnabled();
  await expect.element(getByLabelText("Book selected dates")).toBeEnabled();
});
