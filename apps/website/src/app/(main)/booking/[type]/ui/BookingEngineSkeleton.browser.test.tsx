import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { BookingEngineSkeleton } from "./BookingEngineSkeleton";

test("renders a pulsing three-cell dates row plus the real pricing content underneath", async () => {
  const { getByTestId, getByText } = await render(<BookingEngineSkeleton />);

  const datesRow = getByTestId("booking-skeleton-dates");
  await expect.element(datesRow).toBeInTheDocument();
  await expect.element(datesRow).toHaveClass(/animate-pulse/);

  // Three placeholder cells: check-in, check-out, book.
  await expect.element(getByTestId("booking-skeleton-checkin")).toBeInTheDocument();
  await expect.element(getByTestId("booking-skeleton-checkout")).toBeInTheDocument();
  await expect.element(getByTestId("booking-skeleton-book")).toBeInTheDocument();

  // Real BookingPricing, not skeletonized.
  await expect.element(getByText(/night/)).toBeInTheDocument();
});
