import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  encodeCursor,
  filterByName,
  type ProductsPage,
  type ShopSort,
  sortProducts,
} from "@/lib/shop/pagination";
import { allProducts } from "@/lib/shop/products";

// --- Mocks ---

// `"use cache"` is a no-op outside Next's compiler; the cache calls it makes
// are stubbed so the real registry pages straight through.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

const mockCaptureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { GET } from "../route";

// --- Helpers ---

async function get(query = ""): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new NextRequest(`https://issebya.com/api/shop/products${query}`));
  return { status: res.status, body: await res.json() };
}

async function getPage(query = ""): Promise<ProductsPage> {
  const { status, body } = await get(query);
  expect(status).toBe(200);
  return body as ProductsPage;
}

const newest = sortProducts(allProducts, "newest");
const oldest = sortProducts(allProducts, "oldest");

// --- Tests ---

describe("GET /api/shop/products", () => {
  it("returns the six newest products and a cursor by default", async () => {
    const { items, nextCursor } = await getPage();

    expect(items).toHaveLength(6);
    expect(items[0].slug).toBe(newest[0].slug);
    expect(items[0].slug).toBe(newest[0].slug);
    expect(typeof nextCursor).toBe("string");
  });

  it("returns the oldest product first for sort=oldest", async () => {
    const { items } = await getPage("?sort=oldest");

    expect(items[0].slug).toBe(oldest[0].slug);
  });

  it.each(["?cursor=", "?sort="])("treats %s as the newest first page", async (query) => {
    const { items } = await getPage(query);

    expect(items[0].slug).toBe(newest[0].slug);
  });

  it.each(["30", "0", "abc", "2.5"])("rejects limit=%s with 400", async (limit) => {
    const { status } = await get(`?limit=${limit}`);

    expect(status).toBe(400);
  });

  it("rejects an unknown sort with 400", async () => {
    const { status, body } = await get("?sort=bogus");

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Invalid query" });
  });

  it("rejects a garbage cursor with 400", async () => {
    const { status, body } = await get("?cursor=%25%25%25garbage");

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Unknown cursor" });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("rejects a cursor from another sort with 400", async () => {
    const { nextCursor } = await getPage("?sort=oldest");
    const { status, body } = await get(`?sort=newest&cursor=${nextCursor}`);

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Cursor is for a different sort" });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("continues after a cursor whose product has left the registry", async () => {
    // A bookmark for a product that no longer exists still names a position:
    // same day as `anchor`, slug sorting just after it, so the page resumes
    // with whatever follows `anchor` in newest order.
    const anchorIndex = 4;
    const anchor = newest[anchorIndex];
    const cursor = encodeCursor({
      sort: "newest",
      q: "",
      createdAt: anchor.createdAt,
      slug: `${anchor.slug}-gone`,
    });
    const { items } = await getPage(`?cursor=${cursor}`);

    expect(items.map(({ slug }) => slug)).toEqual(
      newest
        .filter(
          (product) =>
            product.createdAt < anchor.createdAt ||
            (product.createdAt === anchor.createdAt && product.slug > `${anchor.slug}-gone`),
        )
        .slice(0, 6)
        .map(({ slug }) => slug),
    );
  });

  it.each<[ShopSort, typeof newest]>([
    ["newest", newest],
    ["oldest", oldest],
  ])("following nextCursor walks the whole %s order", async (sort, expected) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? `?sort=${sort}` : `?sort=${sort}&cursor=${cursor}`;
      const page = await getPage(query);
      seen.push(...page.items.map(({ slug }) => slug));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seen).toEqual(expected.map(({ slug }) => slug));
  });

  it("responds with exactly items, nextCursor and total", async () => {
    const { body } = await get();

    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor", "total"]);
    expect(body.total).toBe(allProducts.length);
  });

  describe("search", () => {
    const silver = sortProducts(filterByName(allProducts, "silver"), "newest");
    const broad = sortProducts(filterByName(allProducts, "a"), "newest");

    it.each(["?q=silver", "?q=%20silver%20", "?q=SILVER"])(
      "returns only the matching products for %s",
      async (query) => {
        const { items, nextCursor, total } = await getPage(query);

        expect(items.map(({ slug }) => slug)).toEqual(silver.map(({ slug }) => slug));
        expect(total).toBe(silver.length);
        expect(nextCursor).toBeNull();
      },
    );

    it.each(["?q=", ""])("treats %j as no search", async (query) => {
      const { total } = await getPage(query);

      expect(total).toBe(allProducts.length);
    });

    it("rejects a term over 60 characters with 400", async () => {
      const { status, body } = await get(`?q=${"a".repeat(61)}`);

      expect(status).toBe(400);
      expect(body).toEqual({ error: "Invalid query" });
    });

    it("pages through the matches with a cursor carrying the term", async () => {
      const first = await getPage("?q=a&limit=10");
      const second = await getPage(`?q=a&limit=10&cursor=${first.nextCursor}`);

      expect([...first.items, ...second.items].map(({ slug }) => slug)).toEqual(
        broad.map(({ slug }) => slug),
      );
      expect(second.nextCursor).toBeNull();
    });

    it("rejects a cursor from another term with 400", async () => {
      const { nextCursor } = await getPage("?q=a&limit=10");
      const { status, body } = await get(`?q=silver&cursor=${nextCursor}`);

      expect(status).toBe(400);
      expect(body).toEqual({ error: "Cursor is for a different search" });
      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });
});
