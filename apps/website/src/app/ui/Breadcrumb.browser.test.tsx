import type { ComponentProps, ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

// `next/link` reaches for `process` at import time (via resolve-href ->
// is-local-url -> has-base-path), which does not exist in a browser-mode test,
// so importing the real one fails the suite outright in firefox. Everything
// asserted below is about roles, accessible names and `href` - none of it
// involves Next's client-side navigation - so a plain <a> is a faithful stand-in.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Breadcrumb } from "./Breadcrumb";

// A real post title, cedilla and all: the trail renders the title as text with
// no slug-ification, so the non-ASCII path is worth exercising here too.
const TITLE = "A weekend in Almoçageme";
const BLOG = { href: "/blog", label: "blog" };

test("the trail is a navigation landmark named Breadcrumb", async () => {
  const { getByRole } = await render(<Breadcrumb parent={BLOG} title={TITLE} />);

  await expect.element(getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
});

test("the first item links back to the blog index", async () => {
  const { getByRole } = await render(<Breadcrumb parent={BLOG} title={TITLE} />);

  await expect.element(getByRole("link", { name: "blog" })).toHaveAttribute("href", "/blog");
});

test("the trail exposes exactly two items to assistive tech", async () => {
  const { getByRole } = await render(<Breadcrumb parent={BLOG} title={TITLE} />);

  // Two, not three: the separator is decoration inside the current item, so a
  // regression that promotes it to its own <li> fails here.
  await expect.element(getByRole("listitem").nth(1)).toBeInTheDocument();
  await expect.element(page.getByRole("listitem").nth(2)).not.toBeInTheDocument();
});

test("the current item is marked aria-current and is not a link", async () => {
  const { getByRole } = await render(<Breadcrumb parent={BLOG} title={TITLE} />);

  await expect.element(getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "page");
  await expect.element(getByRole("listitem").nth(1)).toHaveTextContent(TITLE);
  await expect.element(page.getByRole("link", { name: TITLE })).not.toBeInTheDocument();
});

// The `›` is decoration. If it ever stops being aria-hidden it joins the
// current item's accessible name and a screen reader reads the title as
// "single right-pointing angle quotation mark A weekend in Almoçageme".
test("the separator is hidden from assistive tech", async () => {
  const { container } = await render(<Breadcrumb parent={BLOG} title={TITLE} />);

  const separator = container.querySelector("li[aria-current='page'] span");

  expect(separator?.textContent).toBe("›");
  expect(separator).toHaveAttribute("aria-hidden", "true");
});

test("the first item links to whichever parent it is given", async () => {
  const { getByRole } = await render(
    <Breadcrumb parent={{ href: "/shop", label: "shop" }} title="Sample Product One" />,
  );

  await expect.element(getByRole("link", { name: "shop" })).toHaveAttribute("href", "/shop");
  await expect.element(page.getByRole("link", { name: "blog" })).not.toBeInTheDocument();
});
