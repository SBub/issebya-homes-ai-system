import type { ComponentProps, ComponentType, ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { BlogPost } from "@/lib/blog/schema";

// Same stand-in as src/app/(main)/shop/ui/ProductCard.browser.test.tsx: the
// real `next/link` reaches for `process` at import time, which does not exist
// in a browser-mode test.
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

// `vi.hoisted` because the `vi.mock` factory below is hoisted above any plain
// top-level const.
const POST = vi.hoisted<BlogPost>(() => ({
  slug: "test-post",
  title: "A Test Post",
  description: "A post that exists only for this test.",
  date: "2026-09-01",
  hero: { src: "/frontyard.webp", alt: "A test hero", width: 800, height: 600 },
  Content: () => null,
}));

// The real registry imports `.mdx`, which Vite browser mode cannot transform.
vi.mock("@/lib/blog/posts", () => ({ allPosts: [POST] }));

import BlogIndexPage from "./blog/page";
import ContactPage from "./contact/page";
import ShopIndexPage from "./shop/page";

// The header's site name is the page's only h1 and it lives in the layout, so
// none of these page components may render one of their own: the active nav
// tab already says where the reader is.
test.each<[string, ComponentType]>([
  ["/blog", BlogIndexPage],
  ["/shop", ShopIndexPage],
  ["/contact", ContactPage],
])("%s renders no page-title h1", async (_path, Page) => {
  const screen = await render(<Page />);

  expect(screen.container.querySelector("h1")).toBeNull();
  expect(screen.getByRole("heading", { level: 1 }).query()).toBeNull();
});

test("/blog still lists its posts", async () => {
  const { getByRole } = await render(<BlogIndexPage />);

  await expect.element(getByRole("heading", { level: 2, name: POST.title })).toBeVisible();
});

// Proves the padded wrapper that held the title is gone too, not just the h1,
// so the products section sits directly under the header.
test("/shop opens directly on the products section", async () => {
  const screen = await render(<ShopIndexPage />);
  const products = screen.getByRole("region", { name: "Products" });

  await expect.element(products).toBeVisible();
  expect(screen.container.firstElementChild?.firstElementChild).toBe(products.element());
});

test("/contact still shows its photo", async () => {
  const { getByRole } = await render(<ContactPage />);

  await expect.element(getByRole("img", { name: "Front yard and garden entrance" })).toBeVisible();
});
