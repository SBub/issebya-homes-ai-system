import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { assertUniqueSlugs, type BlogPost, sortPosts, toBlogPost } from "../schema";

// A stand-in for a compiled `.mdx` default export. The schema never renders
// it, it only carries it through, so a bare function is enough and this suite
// stays in the node pool.
const Content: ComponentType = () => null;

const validMeta = {
  title: "A weekend in Almocageme",
  description: "Where to eat, where to surf, and how to get there without a car.",
  date: "2026-08-14",
  slug: "a-weekend-in-almocageme",
};

function post(overrides: Partial<BlogPost> & { slug: string; date: string }): BlogPost {
  return { ...validMeta, ...overrides, Content };
}

describe("toBlogPost", () => {
  it("parses fully valid meta and attaches the content component", () => {
    const result = toBlogPost(validMeta, Content);

    expect(result).toEqual({ ...validMeta, Content });
  });

  it("parses valid meta that includes a hero image", () => {
    const meta = {
      ...validMeta,
      hero: { src: "/terrace.webp", alt: "The terrace at dusk", width: 1200, height: 800 },
    };

    expect(toBlogPost(meta, Content).hero).toEqual(meta.hero);
  });

  it("throws when title is missing", () => {
    const { title: _title, ...withoutTitle } = validMeta;

    expect(() => toBlogPost(withoutTitle, Content)).toThrow();
  });

  it("throws when description is empty", () => {
    expect(() => toBlogPost({ ...validMeta, description: "" }, Content)).toThrow(
      /description is required/i,
    );
  });

  it("throws when date is not in YYYY-MM-DD format", () => {
    expect(() => toBlogPost({ ...validMeta, date: "19-09-2026" }, Content)).toThrow(/YYYY-MM-DD/);
  });

  it("throws when date is well-shaped but not a real calendar date", () => {
    expect(() => toBlogPost({ ...validMeta, date: "2026-02-31" }, Content)).toThrow(
      /not a real calendar date/i,
    );
  });

  it("throws when slug is not kebab-case", () => {
    expect(() => toBlogPost({ ...validMeta, slug: "Not A Slug" }, Content)).toThrow(/kebab-case/i);
  });

  it("throws when hero is present but missing alt text", () => {
    const meta = { ...validMeta, hero: { src: "/terrace.webp", width: 1200, height: 800 } };

    expect(() => toBlogPost(meta, Content)).toThrow();
  });

  it("throws when meta is not an object at all", () => {
    expect(() => toBlogPost(undefined, Content)).toThrow();
  });

  it("parses pinned: true and carries it on the result", () => {
    expect(toBlogPost({ ...validMeta, pinned: true }, Content).pinned).toBe(true);
  });

  it("throws when pinned is not a boolean", () => {
    expect(() => toBlogPost({ ...validMeta, pinned: "yes" }, Content)).toThrow();
  });
});

describe("sortPosts", () => {
  it("puts the newest post first", () => {
    const older = post({ slug: "older", date: "2026-07-01" });
    const newer = post({ slug: "newer", date: "2026-08-14" });

    expect(sortPosts([older, newer]).map(({ slug }) => slug)).toEqual(["newer", "older"]);
  });

  it("does not mutate its input", () => {
    const input = [
      post({ slug: "older", date: "2026-07-01" }),
      post({ slug: "newer", date: "2026-08-14" }),
    ];

    sortPosts(input);

    expect(input.map(({ slug }) => slug)).toEqual(["older", "newer"]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortPosts([])).toEqual([]);
  });

  it("puts a pinned older post ahead of an unpinned newer one", () => {
    const pinnedOld = post({ slug: "pinned-old", date: "2026-01-01", pinned: true });
    const unpinnedNew = post({ slug: "unpinned-new", date: "2026-08-14" });

    expect(sortPosts([unpinnedNew, pinnedOld]).map(({ slug }) => slug)).toEqual([
      "pinned-old",
      "unpinned-new",
    ]);
  });

  it("orders the pinned and the unpinned group each newest first", () => {
    const unpinnedOld = post({ slug: "unpinned-old", date: "2026-07-01" });
    const pinnedOld = post({ slug: "pinned-old", date: "2026-02-01", pinned: true });
    const unpinnedNew = post({ slug: "unpinned-new", date: "2026-08-14" });
    const pinnedNew = post({ slug: "pinned-new", date: "2026-03-01", pinned: true });

    expect(
      sortPosts([unpinnedOld, pinnedOld, unpinnedNew, pinnedNew]).map(({ slug }) => slug),
    ).toEqual(["pinned-new", "pinned-old", "unpinned-new", "unpinned-old"]);
  });

  it("keeps input order for unpinned posts on the same date", () => {
    const a = post({ slug: "a", date: "2026-08-14" });
    const b = post({ slug: "b", date: "2026-08-14" });

    expect(sortPosts([a, b]).map(({ slug }) => slug)).toEqual(["a", "b"]);
    expect(sortPosts([b, a]).map(({ slug }) => slug)).toEqual(["b", "a"]);
  });

  it("keeps input order for pinned posts on the same date", () => {
    const a = post({ slug: "a", date: "2026-08-14", pinned: true });
    const b = post({ slug: "b", date: "2026-08-14", pinned: true });

    expect(sortPosts([a, b]).map(({ slug }) => slug)).toEqual(["a", "b"]);
    expect(sortPosts([b, a]).map(({ slug }) => slug)).toEqual(["b", "a"]);
  });

  it("treats pinned: false the same as omitted", () => {
    const explicitFalse = post({ slug: "explicit-false", date: "2026-07-01", pinned: false });
    const omitted = post({ slug: "omitted", date: "2026-08-14" });
    const pinned = post({ slug: "pinned", date: "2026-01-01", pinned: true });

    expect(sortPosts([explicitFalse, omitted, pinned]).map(({ slug }) => slug)).toEqual([
      "pinned",
      "omitted",
      "explicit-false",
    ]);
  });

  it("does not mutate its input when pinned posts are present", () => {
    const input = [
      post({ slug: "unpinned", date: "2026-08-14" }),
      post({ slug: "pinned", date: "2026-07-01", pinned: true }),
    ];

    sortPosts(input);

    expect(input.map(({ slug }) => slug)).toEqual(["unpinned", "pinned"]);
  });
});

describe("assertUniqueSlugs", () => {
  it("accepts a list of distinct slugs", () => {
    const posts = [
      post({ slug: "one", date: "2026-07-01" }),
      post({ slug: "two", date: "2026-08-14" }),
    ];

    expect(() => assertUniqueSlugs(posts)).not.toThrow();
  });

  it("throws naming the duplicated slug", () => {
    const posts = [
      post({ slug: "twice", date: "2026-07-01" }),
      post({ slug: "twice", date: "2026-08-14" }),
    ];

    expect(() => assertUniqueSlugs(posts)).toThrow(/twice/);
  });
});
