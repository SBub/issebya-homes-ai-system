import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Product, ProductImage } from "@/lib/shop/schema";

// Same stand-in as src/app/ui/Breadcrumb.browser.test.tsx: the real
// `next/link` reaches for `process` at import time, which does not exist in a
// browser-mode test. Everything asserted here is roles, names and `href`.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `next/image` is not under test here, and a plain <img> keeps the suite
// independent of the image optimizer.
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { ProductCard } from "./ProductCard";

const image = (alt: string, n: number): ProductImage => ({
  src: `/shop/sample-0${n}.webp`,
  alt,
  width: 800,
  height: 800,
});

const ONE: Product = {
  slug: "linen-throw",
  brand: "Test Brand",
  name: "Linen Throw",
  price: { amount: 1200, currency: "EUR" },
  description: "A light throw for cool evenings on the terrace.",
  details: "Washed linen, 130 x 170 cm.",
  images: [image("A folded linen throw", 1)],
};

const THREE: Product = {
  ...ONE,
  images: [image("Front", 1), image("Side", 2), image("Back", 3)],
};

beforeEach(() => {
  mockCapture.mockClear();
});

function swipe(target: Element, fromX: number, toX: number) {
  const start = new Touch({ identifier: 1, target, clientX: fromX, clientY: 0 });
  const end = new Touch({ identifier: 1, target, clientX: toX, clientY: 0 });
  target.dispatchEvent(
    new TouchEvent("touchstart", { bubbles: true, touches: [start], changedTouches: [start] }),
  );
  target.dispatchEvent(
    new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [end] }),
  );
}

test("the card shows numeral, brand, name, price and description", async () => {
  const { getByText } = await render(<ProductCard product={ONE} position={3} />);

  await expect.element(getByText("III", { exact: true })).toBeVisible();
  await expect.element(getByText("Test Brand")).toBeVisible();
  await expect.element(getByText("Linen Throw", { exact: true })).toBeVisible();
  await expect.element(getByText("€12.00")).toBeVisible();
  await expect.element(getByText(ONE.description)).toBeVisible();
});

// The only link a screen reader meets is the product name. The photo link is
// an aria-hidden, pointer-only duplicate.
test("the card is an article whose only accessible link is the product name", async () => {
  const { getByRole } = await render(<ProductCard product={THREE} position={3} />);

  await expect.element(getByRole("article", { name: "Linen Throw" })).toBeInTheDocument();
  await expect
    .element(getByRole("link", { name: "Linen Throw", exact: true }))
    .toHaveAttribute("href", "/shop/linen-throw");
  await expect.element(page.getByRole("link", { name: "III" })).not.toBeInTheDocument();
  await expect.element(getByRole("link").nth(1)).not.toBeInTheDocument();
});

// The photo sits inside the aria-hidden photo link, so it is found through
// that link with `includeHidden` (which would also match the chevron SVGs if
// it were not scoped).
const photo = (screen: { getByRole: typeof page.getByRole }) =>
  screen.getByRole("link", { includeHidden: true }).getByRole("img", { includeHidden: true });

test("a single-image product has no arrows, no live region and no captures", async () => {
  const { getByRole, getByText } = await render(<ProductCard product={ONE} position={1} />);

  await expect
    .element(getByRole("img", { name: "A folded linen throw", includeHidden: true }))
    .toBeVisible();
  await expect.element(getByRole("button")).not.toBeInTheDocument();
  await expect.element(getByText("Image 1 of 1")).not.toBeInTheDocument();
  expect(mockCapture).not.toHaveBeenCalled();
});

test("next and previous flip through the images and wrap around", async () => {
  const screen = await render(<ProductCard product={THREE} position={1} />);
  const { getByRole } = screen;
  const img = photo(screen);
  const next = getByRole("button", { name: "Next image" });
  const previous = getByRole("button", { name: "Previous image" });

  await expect.element(img).toHaveAttribute("alt", "Front");
  await next.click();
  await expect.element(img).toHaveAttribute("alt", "Side");
  await next.click();
  await expect.element(img).toHaveAttribute("alt", "Back");
  await next.click();
  await expect.element(img).toHaveAttribute("alt", "Front");
  await previous.click();
  await expect.element(img).toHaveAttribute("alt", "Back");
});

test("only the current image is rendered", async () => {
  const { container } = await render(<ProductCard product={THREE} position={1} />);

  expect(container.querySelectorAll("img")).toHaveLength(1);
});

test("the carousel is labelled and announces the current image", async () => {
  const { getByRole, getByText } = await render(<ProductCard product={THREE} position={1} />);

  await expect
    .element(getByRole("group", { name: "Product images" }))
    .toHaveAttribute("aria-roledescription", "carousel");
  await getByRole("button", { name: "Next image" }).click();
  await expect.element(getByText("Image 2 of 3")).toHaveAttribute("aria-live", "polite");
});

test("the arrows are not inside the link", async () => {
  const { container } = await render(<ProductCard product={THREE} position={1} />);

  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.closest("a")).toBeNull();
  }
});

test("an arrow click captures shop_card_image_changed", async () => {
  const { getByRole } = await render(<ProductCard product={THREE} position={1} />);

  await getByRole("button", { name: "Next image" }).click();

  expect(mockCapture).toHaveBeenCalledTimes(1);
  expect(mockCapture).toHaveBeenCalledWith("shop_card_image_changed", {
    product_slug: "linen-throw",
    index: 1,
    trigger: "arrow",
  });
});

test("a swipe over 50px advances, a shorter one does nothing", async () => {
  const screen = await render(<ProductCard product={THREE} position={1} />);
  const carousel = screen.getByRole("group", { name: "Product images" }).element();
  const img = photo(screen);

  swipe(carousel, 200, 170);
  await expect.element(img).toHaveAttribute("alt", "Front");
  expect(mockCapture).not.toHaveBeenCalled();

  swipe(carousel, 200, 100);
  await expect.element(img).toHaveAttribute("alt", "Side");
  expect(mockCapture).toHaveBeenCalledWith("shop_card_image_changed", {
    product_slug: "linen-throw",
    index: 1,
    trigger: "swipe",
  });
});

// The outer onClick stands in for any enclosing clickable, such as the old
// whole-card link.
test("an arrow click advances the image without navigating", async () => {
  const outerClick = vi.fn();
  const defaultPrevented: boolean[] = [];
  const record = (event: Event) => {
    setTimeout(() => defaultPrevented.push(event.defaultPrevented));
  };
  document.addEventListener("click", record, true);
  const before = window.location.href;

  try {
    const screen = await render(
      <div onClick={outerClick}>
        <ProductCard product={THREE} position={1} />
      </div>,
    );

    await screen.getByRole("button", { name: "Next image" }).click();

    await expect.element(photo(screen)).toHaveAttribute("alt", "Side");
    expect(outerClick).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    await expect.poll(() => defaultPrevented).toEqual([true]);
  } finally {
    document.removeEventListener("click", record, true);
  }
});
