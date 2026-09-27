import { describe, expect, it } from "vitest";
import {
  CursorSortMismatchError,
  decodeCursor,
  encodeCursor,
  type ShopSort,
  selectPage,
  shopProductsQueryKey,
  sortProducts,
  UnknownCursorError,
} from "../pagination";
import type { Product } from "../schema";

const product = (name: string, createdAt: string): Product => ({
  slug: `product-${name}`,
  brand: "Test Brand",
  name: `Product ${name}`,
  price: { amount: 1000, currency: "EUR" },
  description: "A test product.",
  details: "Test details.",
  images: [{ src: "/shop/sample-01.webp", alt: `Product ${name}`, width: 800, height: 800 }],
  createdAt,
});

const pad = (n: number) => String(n).padStart(2, "0");

// Fifteen distinct days, one per product: `product-NN` was added on 2026-01-NN,
// so newest first is 15 down to 01. Listed in file order 01..15.
const fifteen = Array.from({ length: 15 }, (_, i) => product(pad(i + 1), `2026-01-${pad(i + 1)}`));
const slugs = (items: readonly Product[]) => items.map(({ slug }) => slug);
const numbered = (...ns: number[]) => ns.map((n) => `product-${pad(n)}`);

/** Every page of `products` in `sort`, following `nextCursor` to the end. */
function walk(products: readonly Product[], sort: ShopSort, limit = 6): Product[][] {
  const pages: Product[][] = [];
  let cursor: string | null = null;
  do {
    const page = selectPage(products, cursor, limit, sort);
    pages.push(page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

describe("sortProducts", () => {
  const sameDay = [
    product("b", "2026-03-01"),
    product("c", "2026-03-01"),
    product("old", "2026-01-01"),
    product("a", "2026-03-01"),
    product("new", "2026-05-01"),
  ];

  it("sorts newest first, a shared day by slug ascending", () => {
    expect(slugs(sortProducts(sameDay, "newest"))).toEqual([
      "product-new",
      "product-a",
      "product-b",
      "product-c",
      "product-old",
    ]);
  });

  it("sorts oldest first as the exact reverse of newest", () => {
    expect(slugs(sortProducts(sameDay, "oldest"))).toEqual(
      slugs(sortProducts(sameDay, "newest")).reverse(),
    );
  });

  it("does not mutate its input", () => {
    const input = [...sameDay];

    sortProducts(input, "newest");

    expect(input).toEqual(sameDay);
  });
});

describe("selectPage", () => {
  it.each<[ShopSort, string[][]]>([
    ["newest", [numbered(15, 14, 13, 12, 11, 10), numbered(9, 8, 7, 6, 5, 4), numbered(3, 2, 1)]],
    ["oldest", [numbered(1, 2, 3, 4, 5, 6), numbered(7, 8, 9, 10, 11, 12), numbered(13, 14, 15)]],
  ])("pages %s through to a short last page with no cursor", (sort, expected) => {
    const first = selectPage(fifteen, null, 6, sort);
    const second = selectPage(fifteen, first.nextCursor, 6, sort);
    const third = selectPage(fifteen, second.nextCursor, 6, sort);

    expect([slugs(first.items), slugs(second.items), slugs(third.items)]).toEqual(expected);
    expect(first.nextCursor).not.toBeNull();
    expect(third.nextCursor).toBeNull();
  });

  it.each<ShopSort>(["newest", "oldest"])(
    "never hands out a cursor to an empty page on an exact multiple (%s)",
    (sort) => {
      const twelve = fifteen.slice(0, 12);
      const second = selectPage(twelve, selectPage(twelve, null, 6, sort).nextCursor, 6, sort);

      expect(second.items).toHaveLength(6);
      expect(second.nextCursor).toBeNull();
    },
  );

  it("returns an empty last page for an empty registry", () => {
    expect(selectPage([], null, 6, "newest")).toEqual({ items: [], nextCursor: null });
  });

  // Items 6, 7 and 8 share a day, in both orders, so the page boundary falls
  // inside the tie. Only the slug tie-break keeps 7 and 8 on page two.
  describe("a day shared across the page boundary", () => {
    const thirteen = [
      product("o13", "2026-01-01"),
      product("tie-b", "2026-03-01"),
      product("n01", "2026-06-10"),
      product("o09", "2026-02-05"),
      product("n05", "2026-06-06"),
      product("tie-c", "2026-03-01"),
      product("o11", "2026-02-03"),
      product("n02", "2026-06-09"),
      product("o10", "2026-02-04"),
      product("tie-a", "2026-03-01"),
      product("n04", "2026-06-07"),
      product("o12", "2026-02-02"),
      product("n03", "2026-06-08"),
    ];
    const named = (...names: string[]) => names.map((name) => `product-${name}`);

    it("newest: page two starts at the second item of the shared day", () => {
      expect(walk(thirteen, "newest").map(slugs)).toEqual([
        named("n01", "n02", "n03", "n04", "n05", "tie-a"),
        named("tie-b", "tie-c", "o09", "o10", "o11", "o12"),
        named("o13"),
      ]);
    });

    it("oldest: page two starts at the second item of the shared day", () => {
      expect(walk(thirteen, "oldest").map(slugs)).toEqual([
        named("o13", "o12", "o11", "o10", "o09", "tie-c"),
        named("tie-b", "tie-a", "n05", "n04", "n03", "n02"),
        named("n01"),
      ]);
    });
  });

  describe("the catalogue changing between two page loads", () => {
    it.each<[ShopSort, Product]>([
      ["newest", product("brand-new", "2026-12-31")],
      ["oldest", product("ancient", "2025-01-01")],
    ])("%s: an item added before the bookmark shifts nothing", (sort, added) => {
      const { nextCursor } = selectPage(fifteen, null, 6, sort);
      const pageTwoBefore = selectPage(fifteen, nextCursor, 6, sort);
      const pageTwoAfter = selectPage([...fifteen, added], nextCursor, 6, sort);

      expect(slugs(pageTwoAfter.items)).toEqual(slugs(pageTwoBefore.items));
    });

    it.each<ShopSort>(["newest", "oldest"])(
      "%s: removing the bookmarked item itself still continues after it",
      (sort) => {
        const first = selectPage(fifteen, null, 6, sort);
        const bookmarked = first.items.at(-1)?.slug;
        const without = fifteen.filter(({ slug }) => slug !== bookmarked);

        const pageTwoBefore = selectPage(fifteen, first.nextCursor, 6, sort);
        const pageTwoAfter = selectPage(without, first.nextCursor, 6, sort);

        expect(slugs(pageTwoAfter.items)).toEqual(slugs(pageTwoBefore.items));
        expect(slugs(pageTwoAfter.items)).not.toContain(bookmarked);
      },
    );

    // `zz-gone` sorts after `product-10` on the same day, so page two starts at 09.
    it("continues after the bookmark tuple when its slug is unknown", () => {
      const cursor = encodeCursor({
        sort: "newest",
        createdAt: "2026-01-10",
        slug: "zz-gone",
      });

      expect(slugs(selectPage(fifteen, cursor, 6, "newest").items)).toEqual(
        numbered(9, 8, 7, 6, 5, 4),
      );
    });
  });
});

describe("cursor codec", () => {
  const bookmark = { sort: "oldest", createdAt: "2026-05-03", slug: "sample-product-one" } as const;

  it("round-trips { sort, createdAt, slug }", () => {
    expect(decodeCursor(encodeCursor(bookmark), "oldest")).toEqual(bookmark);
  });

  it("is opaque and base64url-safe", () => {
    const cursor = encodeCursor(bookmark);

    expect(cursor).not.toContain("sample-product-one");
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a cursor handed out for another sort", () => {
    const cursor = encodeCursor({ ...bookmark, sort: "newest" });

    expect(() => decodeCursor(cursor, "oldest")).toThrow(CursorSortMismatchError);
    expect(() => selectPage(fifteen, cursor, 6, "oldest")).toThrow(CursorSortMismatchError);
  });

  const base64 = (text: string) => btoa(text).replace(/=+$/, "");

  it.each([
    ["not base64", "%%%garbage"],
    ["a legacy after:<slug> cursor", base64("after:sample-product-one")],
    ["JSON missing fields", base64(JSON.stringify({ sort: "newest" }))],
    ["an invalid createdAt", base64(JSON.stringify({ ...bookmark, createdAt: "2026-02-30" }))],
    ["an empty slug", base64(JSON.stringify({ ...bookmark, slug: "" }))],
    ["an unknown sort", base64(JSON.stringify({ ...bookmark, sort: "price" }))],
  ])("rejects %s with UnknownCursorError", (_label, cursor) => {
    expect(() => decodeCursor(cursor, "oldest")).toThrow(UnknownCursorError);
  });
});

it("keys the query on the page size and the sort", () => {
  expect(shopProductsQueryKey("oldest")).toEqual(["shop", "products", 6, "oldest"]);
});
