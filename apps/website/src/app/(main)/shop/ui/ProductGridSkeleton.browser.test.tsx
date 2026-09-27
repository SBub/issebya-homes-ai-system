import type { ComponentProps, ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Product } from "@/lib/shop/schema";

// Same stand-ins as ProductCard.browser.test.tsx: the real card is rendered
// for the size comparison, without the real `next/link`, `next/image` or SDK.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { ProductCard } from "./ProductCard";
import { PRODUCT_GRID_CLASS, ProductGridSkeleton } from "./ProductGridSkeleton";

const PRODUCT: Product = {
  slug: "linen-throw",
  brand: "Test Brand",
  name: "Linen Throw",
  price: { amount: 1200, currency: "EUR" },
  description: "A light throw for cool evenings on the terrace.",
  details: "Washed linen, 130 x 170 cm.",
  images: [{ src: "/shop/sample-01.webp", alt: "A folded linen throw", width: 800, height: 800 }],
  createdAt: "2026-05-03",
};

test("renders count card-sized boxes, hidden, with one loading status", async () => {
  const screen = await render(<ProductGridSkeleton count={6} />);

  const list = screen.container.querySelector("ul");
  expect(list?.getAttribute("aria-hidden")).toBe("true");
  expect(list?.className).toBe(PRODUCT_GRID_CLASS);

  const boxes = [...(list?.querySelectorAll(":scope > li > div") ?? [])];
  expect(boxes).toHaveLength(6);
  for (const box of boxes) {
    for (const cls of ["aspect-[3/5]", "md:max-lg:aspect-auto", "md:max-lg:min-h-[26rem]"]) {
      expect(box.classList.contains(cls)).toBe(true);
    }
  }

  await expect.element(screen.getByRole("status")).toHaveTextContent("Loading products");
  expect(screen.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(screen.container.querySelector("button, a")).toBeNull();
});

// Proves nothing jumps when the cards replace the skeleton.
test("at desktop width a skeleton box is exactly as tall as a real card", async () => {
  await page.viewport(1280, 900);
  const screen = await render(
    <div className="w-[1180px]">
      <ProductGridSkeleton count={3} />
      <ul className={PRODUCT_GRID_CLASS}>
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <ProductCard product={{ ...PRODUCT, slug: `${PRODUCT.slug}-${i}` }} />
          </li>
        ))}
      </ul>
    </div>,
  );
  await expect.element(screen.getByRole("article").first()).toBeVisible();

  const skeletonBox = screen.container.querySelector("ul[aria-hidden] > li > div");
  const card = screen.container.querySelector("article");
  const skeletonHeight = skeletonBox?.getBoundingClientRect().height ?? 0;
  const cardHeight = card?.getBoundingClientRect().height ?? -1;

  expect(skeletonHeight).toBeGreaterThan(0);
  expect(Math.abs(skeletonHeight - cardHeight)).toBeLessThanOrEqual(1);
});
