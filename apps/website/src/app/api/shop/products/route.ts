import { captureException } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProductsPage } from "@/lib/shop/pages";
import {
  CursorSortMismatchError,
  DEFAULT_SHOP_SORT,
  decodeCursor,
  SHOP_PAGE_SIZE,
  shopSortSchema,
  UnknownCursorError,
} from "@/lib/shop/pagination";

// An empty `cursor=` or `sort=` means the same as leaving it out.
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(SHOP_PAGE_SIZE),
  cursor: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  sort: z.preprocess(emptyToUndefined, shopSortSchema.default(DEFAULT_SHOP_SORT)),
});

/**
 * `GET /api/shop/products?cursor=&limit=&sort=`: pages 2+ of the `/shop` grid.
 * Page one never comes through here; the page prefetches it on the server
 * from the same `getProductsPage`.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { cursor, limit, sort } = parsed.data;

  // Checked here, outside the cache: see `decodeCursor`. A bad cursor never
  // reaches `getProductsPage`, so it never becomes a cache entry either.
  if (cursor !== undefined) {
    try {
      decodeCursor(cursor, sort);
    } catch (error) {
      if (error instanceof UnknownCursorError) {
        return NextResponse.json({ error: "Unknown cursor" }, { status: 400 });
      }
      if (error instanceof CursorSortMismatchError) {
        return NextResponse.json({ error: "Cursor is for a different sort" }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    const { items, nextCursor } = await getProductsPage(cursor ?? null, limit, sort);
    return NextResponse.json({ items, nextCursor });
  } catch (error) {
    captureException(error);
    return NextResponse.json({ error: "Unable to load products." }, { status: 500 });
  }
}
