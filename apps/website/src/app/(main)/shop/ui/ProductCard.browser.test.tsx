import type { ComponentProps, ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Product } from "@/lib/shop/schema";

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

import { ProductCard } from "./ProductCard";

const PRODUCT: Product = {
  slug: "linen-throw",
  brand: "Test Brand",
  name: "Linen Throw",
  price: { amount: 1200, currency: "EUR" },
  description: "A light throw for cool evenings on the terrace.",
  details: "Washed linen, 130 x 170 cm.",
  image: { src: "/shop/sample-01.webp", alt: "A folded linen throw", width: 800, height: 800 },
};

test("the card shows numeral, brand, name, price and description", async () => {
  const { getByText } = await render(<ProductCard product={PRODUCT} position={3} />);

  await expect.element(getByText("III", { exact: true })).toBeVisible();
  await expect.element(getByText("Test Brand")).toBeVisible();
  await expect.element(getByText("Linen Throw", { exact: true })).toBeVisible();
  await expect.element(getByText("€12.00")).toBeVisible();
  await expect.element(getByText(PRODUCT.description)).toBeVisible();
});

// The link's accessible name must be the product name alone, not the numeral,
// the image alt or the description, which is what aria-labelledby guarantees.
test("the whole card is one link named after the product", async () => {
  const { getByRole } = await render(<ProductCard product={PRODUCT} position={3} />);

  await expect
    .element(getByRole("link", { name: "Linen Throw", exact: true }))
    .toHaveAttribute("href", "/shop/linen-throw");
  await expect.element(page.getByRole("link", { name: "III" })).not.toBeInTheDocument();
  await expect.element(getByRole("link").nth(1)).not.toBeInTheDocument();
});
