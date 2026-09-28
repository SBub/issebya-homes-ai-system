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

// The product list pulls in `next/cache` and the server registry. Only the
// `/shop` shell (Products section first, no h1) is under test here.
vi.mock("./shop/ui/ShopProducts", () => ({ ShopProducts: () => null }));

// The grid's error boundary imports `@sentry/nextjs`, which reaches for
// `process` at import time. It renders nothing of its own on the happy path.
vi.mock("./shop/ui/ShopGridBoundary", () => ({
  ShopGridBoundary: ({ children }: { children: ReactNode }) => children,
}));

// The live controls call `useRouter` and `useSearchParams`, which need the
// Next app router. Only the section around them is under test here.
vi.mock("./shop/ui/ShopControls", () => ({
  ShopControls: ({ children }: { children: ReactNode }) => children,
}));

import BlogIndexPage from "./blog/page";
import ContactPage from "./contact/page";
import ShopPage from "./shop/page";

// `ShopProducts` is mocked, so the searchParams promise is never awaited.
const ShopIndexPage = () => (
  <ShopPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />
);

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

  // The post title is a `<span>` labelling the card's link via
  // `aria-labelledby`, not a heading — same single-h1 rationale as the test
  // above: the link's accessible name is enough, no heading element needed.
  await expect.element(getByRole("link", { name: POST.title })).toBeVisible();
});

// Proves the padded wrapper that held the title is gone too, not just the h1,
// so the products section sits directly under the header.
test("/shop opens directly on the products section", async () => {
  const screen = await render(<ShopIndexPage />);
  const products = screen.getByRole("region", { name: "Products" });

  await expect.element(products).toBeVisible();
  expect(screen.container.firstElementChild?.firstElementChild).toBe(products.element());
});

test("/contact shows no title and no photo, only its text", async () => {
  const { getByRole, getByText } = await render(<ContactPage />);

  expect(getByRole("heading", { level: 2 }).query()).toBeNull();
  expect(getByRole("img", { name: "Front yard and garden entrance" }).query()).toBeNull();
  await expect.element(getByText(/we're here to help/)).toBeVisible();
});
