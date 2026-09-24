import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  WISHLIST_DIALOG_HEADING,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_SAVE_LABEL,
  WISHLIST_SAVED_LABEL,
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
  // `.first()` is the trigger: the dialog's own "Save to wishlist" submit
  // renders after it in DOM order, and only while the dialog is open.
  const trigger = screen.getByRole("button", { name: /^saved? to wishlist$/i }).first();
  const dialog = () => screen.getByRole("dialog", { name: WISHLIST_DIALOG_HEADING });
  return { screen, trigger, dialog };
}

async function saveAs({ screen, dialog }: Awaited<ReturnType<typeof renderDialog>>) {
  await userEvent.fill(screen.getByLabelText("Email"), "guest@example.com");
  await userEvent.click(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY }));
  await userEvent.click(dialog().getByRole("button", { name: "Save to wishlist" }));
}

function dialogElement() {
  return document.querySelector("dialog") as HTMLDialogElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddToWishlist.mockReset();
  window.localStorage.clear();
});

test("the trigger reads Save to wishlist, unpressed, with an empty heart", async () => {
  const { screen, trigger } = await renderDialog();

  await expect.element(screen.getByRole("button", { name: /^save to wishlist$/i })).toBeVisible();
  // Visible text is the accessible name; there is no aria-label.
  await expect.element(trigger).toHaveAccessibleName(WISHLIST_SAVE_LABEL);
  await expect.element(trigger).toHaveTextContent(WISHLIST_SAVE_LABEL);
  await expect.element(trigger).not.toHaveAttribute("aria-pressed");
  await expect.element(trigger).not.toHaveAttribute("aria-label");
  expect(trigger.element().querySelector('svg[data-filled="false"]')).not.toBeNull();
  // The heart sits before the text.
  expect(trigger.element().firstElementChild?.tagName.toLowerCase()).toBe("svg");
});

test("clicking the trigger opens the labelled modal and captures the event", async () => {
  const { screen, trigger, dialog } = await renderDialog();

  await userEvent.click(trigger);

  await expect.element(dialog()).toBeVisible();
  expect(dialogElement().open).toBe(true);
  await expect.element(screen.getByLabelText("Email")).toHaveFocus();
  await expect.element(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY })).toBeVisible();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_form_opened", { product_slug: SLUG });
});

test("Escape closes the dialog and returns focus to the trigger", async () => {
  const { trigger } = await renderDialog();
  await userEvent.click(trigger);

  await userEvent.keyboard("{Escape}");

  await expect.poll(() => dialogElement().open).toBe(false);
  await expect.element(trigger).toHaveFocus();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_dialog_dismissed", {
    product_slug: SLUG,
    had_submitted: false,
  });
});

test("the Close button closes the dialog", async () => {
  const { screen, trigger } = await renderDialog();
  await userEvent.click(trigger);

  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  await expect.poll(() => dialogElement().open).toBe(false);
  await expect.element(trigger).toHaveFocus();
});

test("submit stays disabled with the helper shown until the opt-in is ticked", async () => {
  const { screen, trigger, dialog } = await renderDialog();
  await userEvent.click(trigger);

  const submit = dialog().getByRole("button", { name: "Save to wishlist" });
  await expect.element(submit).toBeDisabled();
  await expect.element(screen.getByText(WISHLIST_OPT_IN_HELPER)).toBeVisible();

  await userEvent.click(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY }));

  await expect.element(submit).toBeEnabled();
  await expect.element(screen.getByText(WISHLIST_OPT_IN_HELPER)).not.toBeInTheDocument();
});

test("a new save shows the confirmation panel, fills the heart and remembers the email", async () => {
  mockAddToWishlist.mockResolvedValue(success(true));
  const rendered = await renderDialog();
  const { screen, trigger, dialog } = rendered;
  await userEvent.click(trigger);

  await saveAs(rendered);

  const panel = dialog().getByRole("status");
  await expect.element(panel).toBeVisible();
  await expect.element(panel.getByRole("heading", { name: NAME })).toBeVisible();
  await expect.element(panel).toHaveTextContent(WISHLIST_SUCCESS_COPY);
  await expect.element(panel).toHaveTextContent("We've sent a note to guest@example.com.");

  const saved = screen.getByRole("button", { name: /^saved to wishlist$/i });
  await expect.element(saved).toHaveAttribute("aria-pressed", "true");
  await expect.element(trigger).toHaveAccessibleName(WISHLIST_SAVED_LABEL);
  await expect.element(trigger).toHaveTextContent(WISHLIST_SAVED_LABEL);
  await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
  await expect.element(trigger).not.toHaveAttribute("aria-label");
  expect(trigger.element().querySelector('svg[data-filled="true"]')).not.toBeNull();
  expect(mockCapture).toHaveBeenCalledWith("wishlist_item_added", { product_slug: SLUG });
  expect(window.localStorage.getItem("issebya.shop.wishlist.email")).toBe("guest@example.com");

  await userEvent.click(panel.getByRole("button", { name: "Close" }));

  await expect.poll(() => dialogElement().open).toBe(false);
  expect(mockCapture).toHaveBeenCalledWith("wishlist_dialog_dismissed", {
    product_slug: SLUG,
    had_submitted: true,
  });
  await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
});

test("an already-wished save shows the panel without the email line", async () => {
  mockAddToWishlist.mockResolvedValue(success(false));
  const rendered = await renderDialog();
  const { trigger, dialog } = rendered;
  await userEvent.click(trigger);

  await saveAs(rendered);

  const panel = dialog().getByRole("status");
  await expect.element(panel).toHaveTextContent(WISHLIST_SUCCESS_COPY);
  await expect.element(panel).not.toHaveTextContent("We've sent a note");
});

test("reopening after a success shows a fresh form while the heart stays filled", async () => {
  mockAddToWishlist.mockResolvedValue(success(true));
  const rendered = await renderDialog();
  const { screen, trigger, dialog } = rendered;
  await userEvent.click(trigger);
  await saveAs(rendered);
  await userEvent.click(screen.getByRole("status").getByRole("button", { name: "Close" }));
  await expect.poll(() => dialogElement().open).toBe(false);

  await userEvent.click(trigger);

  await expect.element(screen.getByLabelText("Email")).toHaveValue("guest@example.com");
  await expect.element(dialog().getByRole("button", { name: "Save to wishlist" })).toBeVisible();
  await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
});

test("a remembered email and consent prefill the form", async () => {
  window.localStorage.setItem("issebya.shop.wishlist.email", "guest@example.com");
  window.localStorage.setItem("issebya.shop.wishlist.consentEmail", "guest@example.com");
  const { screen, trigger } = await renderDialog();

  await userEvent.click(trigger);

  await expect.element(screen.getByLabelText("Email")).toHaveValue("guest@example.com");
  await expect.element(screen.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY })).toBeChecked();
});
