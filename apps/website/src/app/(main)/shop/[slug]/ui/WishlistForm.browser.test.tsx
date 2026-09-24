import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_SUCCESS_COPY,
} from "@/lib/shop/wishlist";

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// The form's action is a real Server Function reference; this module is the
// seam between the component and "the server".
const mockAddToWishlist = vi.fn();
vi.mock("../actions", () => ({
  addToWishlist: (...args: unknown[]) => mockAddToWishlist(...args),
}));

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { WishlistForm } from "./WishlistForm";

const SLUG = "sample-product-one";

beforeEach(() => {
  vi.clearAllMocks();
  mockAddToWishlist.mockReset();
  window.localStorage.clear();
});

test("opening reveals the email field and checkbox, and captures the event", async () => {
  const screen = await render(<WishlistForm productSlug={SLUG} />);

  await userEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));

  await expect.element(screen.getByLabelText("Email")).toBeVisible();
  await expect.element(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY })).toBeVisible();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_form_opened", { product_slug: SLUG });
});

test("submit stays disabled with the helper shown until the opt-in is ticked", async () => {
  const screen = await render(<WishlistForm productSlug={SLUG} />);
  await userEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));

  const submit = screen.getByRole("button", { name: "Save to wishlist" });
  await expect.element(submit).toBeDisabled();
  await expect.element(screen.getByText(WISHLIST_OPT_IN_HELPER)).toBeVisible();

  await userEvent.click(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY }));

  await expect.element(submit).toBeEnabled();
  await expect.element(screen.getByText(WISHLIST_OPT_IN_HELPER)).not.toBeInTheDocument();
});

test("a successful save shows the success copy and remembers the email", async () => {
  mockAddToWishlist.mockResolvedValue({
    attempt: 1,
    ok: true,
    errors: {},
    generalError: "",
    email: "guest@example.com",
  });
  const screen = await render(<WishlistForm productSlug={SLUG} />);
  await userEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));

  await userEvent.fill(screen.getByLabelText("Email"), "guest@example.com");
  await userEvent.click(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY }));
  await userEvent.click(screen.getByRole("button", { name: "Save to wishlist" }));

  await expect.element(screen.getByText(WISHLIST_SUCCESS_COPY)).toBeVisible();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_item_added", { product_slug: SLUG });
  expect(window.localStorage.getItem("issebya.shop.wishlist.email")).toBe("guest@example.com");
});

test("a remembered email and consent prefill the form", async () => {
  window.localStorage.setItem("issebya.shop.wishlist.email", "guest@example.com");
  window.localStorage.setItem("issebya.shop.wishlist.consentEmail", "guest@example.com");
  const screen = await render(<WishlistForm productSlug={SLUG} />);

  await userEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));

  await expect.element(screen.getByLabelText("Email")).toHaveValue("guest@example.com");
  await expect.element(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY })).toBeChecked();
});
