import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { encodeCursor, type ProductsPage } from "@/lib/shop/pagination";
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

// --- Tests ---

describe("GET /api/shop/products", () => {
  it("returns the first six products and a cursor by default", async () => {
    const { items, nextCursor } = await getPage();

    expect(items).toHaveLength(6);
    expect(items[0].slug).toBe(allProducts[0].slug);
    expect(typeof nextCursor).toBe("string");
  });

  it("treats an empty cursor as the first page", async () => {
    const { items } = await getPage("?cursor=");

    expect(items[0].slug).toBe(allProducts[0].slug);
  });

  it.each(["30", "0", "abc", "2.5"])("rejects limit=%s with 400", async (limit) => {
    const { status } = await get(`?limit=${limit}`);

    expect(status).toBe(400);
  });

  it.each([encodeCursor("does-not-exist"), "%%%garbage"])(
    "rejects the cursor %s with 400",
    async (cursor) => {
      const { status, body } = await get(`?cursor=${encodeURIComponent(cursor)}`);

      expect(status).toBe(400);
      expect(body).toEqual({ error: "Unknown cursor" });
      expect(mockCaptureException).not.toHaveBeenCalled();
    },
  );

  it("follows nextCursor to a short last page with no cursor", async () => {
    const first = await getPage();
    const second = await getPage(`?cursor=${first.nextCursor}`);
    const last = await getPage(`?cursor=${second.nextCursor}`);

    expect(last.items).toHaveLength(allProducts.length - 12);
    expect(last.items.at(-1)?.slug).toBe(allProducts.at(-1)?.slug);
    expect(last.nextCursor).toBeNull();
  });

  it("responds with exactly items and nextCursor", async () => {
    const { body } = await get();

    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
  });
});
