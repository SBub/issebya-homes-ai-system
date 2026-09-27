import { captureException } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProductsPage } from "@/lib/shop/pages";
import { cursorStart, SHOP_PAGE_SIZE, UnknownCursorError } from "@/lib/shop/pagination";
import { allProducts } from "@/lib/shop/products";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(SHOP_PAGE_SIZE),
  // An empty `cursor=` means "from the start", same as no cursor at all.
  cursor: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional()),
});

/**
 * `GET /api/shop/products?cursor=&limit=`: pages 2+ of the `/shop` grid.
 * Page one never comes through here; the page prefetches it on the server
 * from the same `getProductsPage`.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { cursor, limit } = parsed.data;

  // Checked here, outside the cache: see `cursorStart`. A bad cursor never
  // reaches `getProductsPage`, so it never becomes a cache entry either.
  try {
    cursorStart(allProducts, cursor ?? null);
  } catch (error) {
    if (error instanceof UnknownCursorError) {
      return NextResponse.json({ error: "Unknown cursor" }, { status: 400 });
    }
    throw error;
  }

  try {
    const { items, nextCursor } = await getProductsPage(cursor ?? null, limit);
    return NextResponse.json({ items, nextCursor });
  } catch (error) {
    captureException(error);
    return NextResponse.json({ error: "Unable to load products." }, { status: 500 });
  }
}
