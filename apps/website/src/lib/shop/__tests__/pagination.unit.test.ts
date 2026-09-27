import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  SHOP_PRODUCTS_QUERY_KEY,
  selectPage,
  UnknownCursorError,
} from "../pagination";
import type { Product } from "../schema";

const product = (n: number): Product => ({
  slug: `product-${n}`,
  brand: "Test Brand",
  name: `Product ${n}`,
  price: { amount: 1000 + n, currency: "EUR" },
  description: "A test product.",
  details: "Test details.",
  images: [{ src: "/shop/sample-01.webp", alt: `Product ${n}`, width: 800, height: 800 }],
});

const fifteen = Array.from({ length: 15 }, (_, i) => product(i));
const slugs = (items: Product[]) => items.map(({ slug }) => slug);

describe("selectPage", () => {
  it("returns the first page and a cursor after its last item", () => {
    const page = selectPage(fifteen, null, 6);

    expect(slugs(page.items)).toEqual(slugs(fifteen.slice(0, 6)));
    expect(page.nextCursor).toBe(encodeCursor(fifteen[5].slug));
  });

  it("follows cursors to the middle and the short last page", () => {
    const first = selectPage(fifteen, null, 6);
    const second = selectPage(fifteen, first.nextCursor, 6);
    const third = selectPage(fifteen, second.nextCursor, 6);

    expect(slugs(second.items)).toEqual(slugs(fifteen.slice(6, 12)));
    expect(slugs(third.items)).toEqual(slugs(fifteen.slice(12, 15)));
    expect(third.nextCursor).toBeNull();
  });

  it("never hands out a cursor to an empty page on an exact multiple", () => {
    const twelve = fifteen.slice(0, 12);
    const second = selectPage(twelve, selectPage(twelve, null, 6).nextCursor, 6);

    expect(second.items).toHaveLength(6);
    expect(second.nextCursor).toBeNull();
  });

  it("throws UnknownCursorError for a slug that is not in the registry", () => {
    expect(() => selectPage(fifteen, encodeCursor("does-not-exist"), 6)).toThrow(
      UnknownCursorError,
    );
  });

  it.each(["%%%garbage", "bm90LWEtY3Vyc29y"])(
    "throws UnknownCursorError for the garbage cursor %s",
    (cursor) => {
      expect(() => selectPage(fifteen, cursor, 6)).toThrow(UnknownCursorError);
    },
  );

  it("returns an empty last page for an empty registry", () => {
    expect(selectPage([], null, 6)).toEqual({ items: [], nextCursor: null });
  });
});

describe("cursor codec", () => {
  it.each(["a", "sample-product-one", "product-14"])("round-trips %s", (slug) => {
    expect(decodeCursor(encodeCursor(slug))).toBe(slug);
  });

  it("is opaque and base64url-safe", () => {
    const cursor = encodeCursor("sample-product-one");

    expect(cursor).not.toContain("sample-product-one");
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a cursor with no slug after the prefix", () => {
    expect(() => decodeCursor(encodeCursor(""))).toThrow(UnknownCursorError);
  });
});

it("keys the query on the page size", () => {
  expect(SHOP_PRODUCTS_QUERY_KEY).toEqual(["shop", "products", 6]);
});
