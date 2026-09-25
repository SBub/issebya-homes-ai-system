import type { ComponentProps, ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { allProducts } from "@/lib/shop/products";

// Same stand-in as index-pages-no-title-heading.browser.test.tsx: the real
// `next/link` reaches for `process` at import time, which does not exist in a
// browser-mode test.
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

// The client islands pull in Server Actions, Supabase, PostHog and Sentry, and
// already have their own browser tests. Only the page layout is under test.
vi.mock("./[slug]/ui/WishlistDialog", () => ({ WishlistDialog: () => null }));
vi.mock("./sell/ui/SellerForm", () => ({ SellerForm: () => null }));
// The product page's image carousel is a client island that captures to
// PostHog; keep the layout test off the real SDK.
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import ProductPage from "./[slug]/page";
import SellPage from "./sell/page";

// Both pages must match the shop index: the yellow card spans the full width
// of <main> with its padding inside, and only the breadcrumb sits on the page
// background above it.
test.each<[string, () => Promise<ReactNode>]>([
  [
    "/shop/[slug]",
    () =>
      ProductPage({
        params: Promise.resolve({ slug: allProducts[0].slug }),
      } as PageProps<"/shop/[slug]">),
  ],
  ["/shop/sell", async () => <SellPage />],
])("%s renders the shop card edge to edge", async (_path, renderPage) => {
  const screen = await render(await renderPage());
  const card = screen.container.querySelector<HTMLElement>(".bg-shop-card");
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" }).element();

  expect(card).not.toBeNull();
  if (!card) return;

  const article = card.parentElement;
  expect(article?.tagName).toBe("ARTICLE");
  for (const cls of ["p-4", "md:p-12", "px-4", "md:px-12"]) {
    expect(article?.classList.contains(cls)).toBe(false);
  }

  for (const cls of ["px-4", "py-8", "md:px-12", "md:py-12"]) {
    expect(card.classList.contains(cls)).toBe(true);
  }
  for (const cls of ["p-4", "md:p-8"]) {
    expect(card.classList.contains(cls)).toBe(false);
  }

  const cardBox = card.getBoundingClientRect();
  const containerBox = screen.container.getBoundingClientRect();
  expect(cardBox.left).toBe(containerBox.left);
  expect(cardBox.width).toBe(containerBox.width);

  expect(card.contains(nav)).toBe(false);
  expect(nav.getBoundingClientRect().bottom).toBeLessThanOrEqual(cardBox.top);
});
