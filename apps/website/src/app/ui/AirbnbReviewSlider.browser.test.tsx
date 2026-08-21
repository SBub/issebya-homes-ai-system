import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AirbnbReviewSlider } from "./AirbnbReviewSlider";

const reviews = [
  { name: "Alice", date: "January 2026", text: "Short review." },
  { name: "Bob", date: "February 2026", text: "Another short review here." },
  {
    name: "Carol",
    date: "March 2026",
    text: "This is a very long review that should definitely exceed three lines of text when rendered in the component. It goes on and on about the wonderful experience, the beautiful location, the amazing host, and all the incredible details that made this stay absolutely unforgettable. Truly a remarkable place that everyone should visit at least once in their lifetime.",
  },
];

describe("AirbnbReviewSlider", () => {
  test("renders nothing when reviews array is empty", async () => {
    const { container } = await render(<AirbnbReviewSlider reviews={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders first review with name, date, and text", async () => {
    const { getByText } = await render(<AirbnbReviewSlider reviews={reviews} />);

    await expect.element(getByText("Alice")).toBeInTheDocument();
    await expect.element(getByText("January 2026")).toBeInTheDocument();
    await expect.element(getByText("Short review.")).toBeInTheDocument();
    await expect.element(getByText("Airbnb")).toBeInTheDocument();
  });

  test("does not show navigation arrows for a single review", async () => {
    const single = [reviews[0]];
    const { container } = await render(<AirbnbReviewSlider reviews={single} />);

    const prevButton = container.querySelector('[aria-label="Previous review"]');
    const nextButton = container.querySelector('[aria-label="Next review"]');
    expect(prevButton).toBeNull();
    expect(nextButton).toBeNull();
  });

  test("shows counter and navigation for multiple reviews", async () => {
    const { getByText, getByRole } = await render(<AirbnbReviewSlider reviews={reviews} />);

    await expect.element(getByText("1 / 3")).toBeInTheDocument();
    await expect.element(getByRole("button", { name: "Previous review" })).toBeInTheDocument();
    await expect.element(getByRole("button", { name: "Next review" })).toBeInTheDocument();
  });

  test("navigates to next review on next button click", async () => {
    const { getByText, getByRole } = await render(<AirbnbReviewSlider reviews={reviews} />);

    await userEvent.click(getByRole("button", { name: "Next review" }));

    await expect.element(getByText("Bob")).toBeInTheDocument();
    await expect.element(getByText("February 2026")).toBeInTheDocument();
    await expect.element(getByText("2 / 3")).toBeInTheDocument();
  });

  test("navigates to previous review on previous button click", async () => {
    const { getByText, getByRole } = await render(<AirbnbReviewSlider reviews={reviews} />);

    // Go to second review first
    await userEvent.click(getByRole("button", { name: "Next review" }));
    await expect.element(getByText("Bob")).toBeInTheDocument();

    // Go back
    await userEvent.click(getByRole("button", { name: "Previous review" }));
    await expect.element(getByText("Alice")).toBeInTheDocument();
    await expect.element(getByText("1 / 3")).toBeInTheDocument();
  });

  test("wraps around from last to first review", async () => {
    const { getByText, getByRole } = await render(<AirbnbReviewSlider reviews={reviews} />);

    // Navigate to last
    await userEvent.click(getByRole("button", { name: "Next review" }));
    await userEvent.click(getByRole("button", { name: "Next review" }));
    await expect.element(getByText("3 / 3")).toBeInTheDocument();

    // Wrap to first
    await userEvent.click(getByRole("button", { name: "Next review" }));
    await expect.element(getByText("Alice")).toBeInTheDocument();
    await expect.element(getByText("1 / 3")).toBeInTheDocument();
  });

  test("wraps around from first to last review", async () => {
    const { getByText, getByRole } = await render(<AirbnbReviewSlider reviews={reviews} />);

    await userEvent.click(getByRole("button", { name: "Previous review" }));
    await expect.element(getByText("Carol")).toBeInTheDocument();
    await expect.element(getByText("3 / 3")).toBeInTheDocument();
  });

  test("toggles expand/collapse on Read more / Show less click", async () => {
    const longReview = [reviews[2]];
    const { getByText } = await render(<AirbnbReviewSlider reviews={longReview} />);

    // Should start with "Read more" visible (long text is clamped)
    const readMoreBtn = getByText("Read more");
    await expect.element(readMoreBtn).toBeVisible();

    // Click to expand
    await userEvent.click(readMoreBtn);
    await expect.element(getByText("Show less")).toBeVisible();

    // Click to collapse
    await userEvent.click(getByText("Show less"));
    await expect.element(getByText("Read more")).toBeVisible();
  });
});
