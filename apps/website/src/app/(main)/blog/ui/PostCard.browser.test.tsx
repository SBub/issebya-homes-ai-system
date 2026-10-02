import type { ComponentProps, ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { BlogPost } from "@/lib/blog/schema";

// Same stand-in as src/app/ui/Breadcrumb.browser.test.tsx: the real
// `next/link` reaches for `process` at import time, which does not exist in a
// browser-mode test. Everything asserted here is roles, names and text.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `next/image` is not under test here, and none of these fixtures has a hero,
// so the stand-in renders nothing and keeps the suite off the image optimizer.
vi.mock("next/image", () => ({
  __esModule: true,
  default: () => null,
}));

import { PostCard } from "./PostCard";

const POST: BlogPost = {
  title: "A weekend in Almocageme",
  description: "Where to eat, where to surf, and how to get there without a car.",
  date: "2026-08-14",
  slug: "a-weekend-in-almocageme",
  Content: () => null,
};

test("a pinned post shows the Pinned label alongside its date", async () => {
  await render(<PostCard post={{ ...POST, pinned: true }} />);

  await expect.element(page.getByText("Pinned", { exact: true })).toBeInTheDocument();
  await expect
    .element(page.getByRole("link", { name: POST.title }))
    .toHaveAttribute("href", "/blog/a-weekend-in-almocageme");
  await expect.element(page.getByText("14 Aug 2026")).toBeInTheDocument();
});

test("a post without pinned shows no label", async () => {
  await render(<PostCard post={POST} />);

  await expect.element(page.getByText("Pinned", { exact: true })).not.toBeInTheDocument();
});

test("a post with pinned: false shows no label", async () => {
  await render(<PostCard post={{ ...POST, pinned: false }} />);

  await expect.element(page.getByText("Pinned", { exact: true })).not.toBeInTheDocument();
});
