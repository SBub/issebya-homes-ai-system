import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

// Mock next/image — renders a plain img
vi.mock("next/image", () => {
  const MockImage = (props: { src: string; alt: string }) => (
    <img src={props.src} alt={props.alt} />
  );
  return { default: MockImage, __esModule: true };
});

// Mock analytics
vi.mock("../../../../../lib/analytics", () => ({
  trackGalleryThumbnailClicked: vi.fn(),
}));

import Gallery from "./Gallery";

const images = [
  { src: "/room1.webp", label: "Bedroom view" },
  { src: "/room2.webp", label: "Bathroom view" },
  { src: "/room3.webp", label: "Garden view" },
];

test("user sees the first image label on render", async () => {
  const { getByText } = await render(<Gallery images={images} />);

  await expect.element(getByText("Bedroom view")).toBeInTheDocument();
});

test("user clicks a thumbnail and sees the corresponding label", async () => {
  const { getByText, getByAltText } = await render(<Gallery images={images} />);

  await userEvent.click(getByAltText("Garden view"));

  await expect.element(getByText("Garden view")).toBeInTheDocument();
});

test("renders nothing for empty images array", async () => {
  const { container } = await render(<Gallery images={[]} />);

  // Component returns null — container should be empty
  expect(container.innerHTML).toBe("");
});
