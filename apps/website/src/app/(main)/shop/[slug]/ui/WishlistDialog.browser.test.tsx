import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  WISHLIST_DIALOG_HEADING,
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

import { WishlistDialog } from "./WishlistDialog";

const SLUG = "sample-product-one";
const NAME = "Sample Product One";

function success(created: boolean) {
  return {
    attempt: 1,
    ok: true,
    errors: {},
    generalError: "",
    email: "guest@example.com",
    created,
  };
}

async function renderDialog() {
  const screen = await render(<WishlistDialog productSlug={SLUG} productName={NAME} />);
  const heart = screen.getByRole("button", { name: /^Add(ed)? to wishlist$/ });
  const dialog = () => screen.getByRole("dialog", { name: WISHLIST_DIALOG_HEADING });
  return { screen, heart, dialog };
}

async function saveAs(screen: Awaited<ReturnType<typeof renderDialog>>["screen"]) {
  await userEvent.fill(screen.getByLabelText("Email"), "guest@example.com");
  await userEvent.click(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY }));
  await userEvent.click(screen.getByRole("button", { name: "Save to wishlist" }));
}

function dialogElement() {
  return document.querySelector("dialog") as HTMLDialogElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddToWishlist.mockReset();
  window.localStorage.clear();
});

test("the heart starts empty and unpressed", async () => {
  const { heart } = await renderDialog();

  await expect.element(heart).toHaveAttribute("aria-label", "Add to wishlist");
  await expect.element(heart).not.toHaveAttribute("aria-pressed");
  expect(heart.element().querySelector('svg[data-filled="false"]')).not.toBeNull();
});

test("clicking the heart opens the labelled modal and captures the event", async () => {
  const { screen, heart, dialog } = await renderDialog();

  await userEvent.click(heart);

  await expect.element(dialog()).toBeVisible();
  expect(dialogElement().open).toBe(true);
  await expect.element(screen.getByLabelText("Email")).toHaveFocus();
  await expect.element(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY })).toBeVisible();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_form_opened", { product_slug: SLUG });
});

test("Escape closes the dialog and returns focus to the heart", async () => {
  const { heart } = await renderDialog();
  await userEvent.click(heart);

  await userEvent.keyboard("{Escape}");

  await expect.poll(() => dialogElement().open).toBe(false);
  await expect.element(heart).toHaveFocus();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_dialog_dismissed", {
    product_slug: SLUG,
    had_submitted: false,
  });
});

test("the Close button closes the dialog", async () => {
  const { screen, heart } = await renderDialog();
  await userEvent.click(heart);

  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  await expect.poll(() => dialogElement().open).toBe(false);
  await expect.element(heart).toHaveFocus();
});

test("submit stays disabled with the helper shown until the opt-in is ticked", async () => {
  const { screen, heart } = await renderDialog();
  await userEvent.click(heart);

  const submit = screen.getByRole("button", { name: "Save to wishlist" });
  await expect.element(submit).toBeDisabled();
  await expect.element(screen.getByText(WISHLIST_OPT_IN_HELPER)).toBeVisible();

  await userEvent.click(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY }));

  await expect.element(submit).toBeEnabled();
  await expect.element(screen.getByText(WISHLIST_OPT_IN_HELPER)).not.toBeInTheDocument();
});

test("a new save shows the confirmation panel, fills the heart and remembers the email", async () => {
  mockAddToWishlist.mockResolvedValue(success(true));
  const { screen, heart, dialog } = await renderDialog();
  await userEvent.click(heart);

  await saveAs(screen);

  const panel = dialog().getByRole("status");
  await expect.element(panel).toBeVisible();
  await expect.element(panel.getByRole("heading", { name: NAME })).toBeVisible();
  await expect.element(panel).toHaveTextContent(WISHLIST_SUCCESS_COPY);
  await expect.element(panel).toHaveTextContent("We've sent a note to guest@example.com.");

  await expect.element(heart).toHaveAttribute("aria-pressed", "true");
  await expect.element(heart).toHaveAttribute("aria-label", "Added to wishlist");
  expect(heart.element().querySelector('svg[data-filled="true"]')).not.toBeNull();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_item_added", { product_slug: SLUG });
  expect(window.localStorage.getItem("issebya.shop.wishlist.email")).toBe("guest@example.com");

  await userEvent.click(panel.getByRole("button", { name: "Close" }));

  await expect.poll(() => dialogElement().open).toBe(false);
  expect(mockCapture).toHaveBeenCalledWith("wishlist_dialog_dismissed", {
    product_slug: SLUG,
    had_submitted: true,
  });
  await expect.element(heart).toHaveAttribute("aria-pressed", "true");
});

test("an already-wished save shows the panel without the email line", async () => {
  mockAddToWishlist.mockResolvedValue(success(false));
  const { screen, heart, dialog } = await renderDialog();
  await userEvent.click(heart);

  await saveAs(screen);

  const panel = dialog().getByRole("status");
  await expect.element(panel).toHaveTextContent(WISHLIST_SUCCESS_COPY);
  await expect.element(panel).not.toHaveTextContent("We've sent a note");
});

test("reopening after a success shows a fresh form while the heart stays filled", async () => {
  mockAddToWishlist.mockResolvedValue(success(true));
  const { screen, heart } = await renderDialog();
  await userEvent.click(heart);
  await saveAs(screen);
  await userEvent.click(screen.getByRole("status").getByRole("button", { name: "Close" }));
  await expect.poll(() => dialogElement().open).toBe(false);

  await userEvent.click(heart);

  await expect.element(screen.getByLabelText("Email")).toHaveValue("guest@example.com");
  await expect.element(screen.getByRole("button", { name: "Save to wishlist" })).toBeVisible();
  await expect.element(heart).toHaveAttribute("aria-pressed", "true");
});

test("a remembered email and consent prefill the form", async () => {
  window.localStorage.setItem("issebya.shop.wishlist.email", "guest@example.com");
  window.localStorage.setItem("issebya.shop.wishlist.consentEmail", "guest@example.com");
  const { screen, heart } = await renderDialog();

  await userEvent.click(heart);

  await expect.element(screen.getByLabelText("Email")).toHaveValue("guest@example.com");
  await expect.element(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY })).toBeChecked();
});
