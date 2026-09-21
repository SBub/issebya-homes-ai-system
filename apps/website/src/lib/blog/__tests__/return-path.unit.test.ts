import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BlogPost } from "../schema";

// The post registry is mocked, and that is not optional: `posts.ts` imports
// `.mdx` files, and the node pool has no MDX transform to resolve them with.
// The fixture knows exactly one slug, which is what lets the "well-shaped but
// unknown slug" cases below mean something.
const KNOWN_SLUG = "a-weekend-in-almocageme";
const KNOWN_TITLE = "A weekend in Almoçageme";

const knownPost: BlogPost = {
  title: KNOWN_TITLE,
  description: "Where to eat, where to surf, and how to get there without a car.",
  date: "2026-08-14",
  slug: KNOWN_SLUG,
  Content: (() => null) as ComponentType,
};

vi.mock("@/lib/blog/posts", () => ({
  getPostBySlug: (slug: string) => (slug === KNOWN_SLUG ? knownPost : undefined),
}));

// Imported dynamically, after `knownPost` above is initialised. `vi.mock` is
// hoisted above every static import, so a static import here would evaluate
// the factory while the fixture is still in its temporal dead zone.
const { BOOKING_WIDGET_ANCHOR_ID, resolveBlogReturn } = await import("../return-path");

describe("resolveBlogReturn", () => {
  it("resolves a real post to its path, widget-anchored href and title", () => {
    expect(resolveBlogReturn(`/blog/${KNOWN_SLUG}`)).toEqual({
      path: `/blog/${KNOWN_SLUG}`,
      href: `/blog/${KNOWN_SLUG}#${BOOKING_WIDGET_ANCHOR_ID}`,
      title: KNOWN_TITLE,
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("resolves %s to null", (_label, value) => {
    expect(resolveBlogReturn(value)).toBeNull();
  });

  // The open-redirect cases. Every one of these would be a live redirect
  // target if the Stripe URLs took the browser's word for it.
  it.each([
    ["an absolute URL", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash-prefixed URL", "/\\evil.example"],
    ["an absolute URL wearing the blog prefix", "https://evil.example/blog/a-weekend"],
  ])("rejects %s", (_label, value) => {
    expect(resolveBlogReturn(value)).toBeNull();
  });

  // Shape alone would let this one through: it is the reason the resolver asks
  // the registry rather than trusting the regex.
  it("rejects a well-shaped path whose slug names no post", () => {
    expect(resolveBlogReturn("/blog/does-not-exist")).toBeNull();
  });

  it.each([
    ["a non-blog internal path", "/booking/room1"],
    ["an API path", "/api/bookings/direct"],
    ["the blog index", "/blog"],
    ["a trailing-slash path", `/blog/${KNOWN_SLUG}/`],
    ["path traversal", "/blog/../booking/room1"],
    ["a nested path", "/blog/a/../b"],
    ["a smuggled query string", `/blog/${KNOWN_SLUG}?x=1`],
    ["a smuggled fragment", `/blog/${KNOWN_SLUG}#evil`],
    ["a relative path", `blog/${KNOWN_SLUG}`],
  ])("rejects %s", (_label, value) => {
    expect(resolveBlogReturn(value)).toBeNull();
  });
});
