import { captureException } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allProducts } from "@/lib/shop/products";
import {
  initialWishlistState,
  WISHLIST_ERROR_COPY,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
} from "@/lib/shop/wishlist";
import { addToWishlist } from "../actions";

// --- Mocks ---

const mockUpsert = vi.fn();
const mockInsert = vi.fn();
const mockFrom = vi.fn((table: string) => {
  if (table === "shop_wishlist_contacts") return { upsert: mockUpsert };
  if (table === "shop_wishlist_items") return { insert: mockInsert };
  throw new Error(`Unexpected table ${table}`);
});
const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }));

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// --- Helpers ---

const [firstProduct] = allProducts;

function formData(overrides: Record<string, string | null> = {}) {
  const fields: Record<string, string | null> = {
    email: "  Guest@Example.com ",
    productSlug: firstProduct.slug,
    marketingOptIn: "on",
    website: "",
    ...overrides,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) fd.set(key, value);
  }
  return fd;
}

// --- Tests ---

describe("addToWishlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ error: null });
  });

  it("records consent before the wish and returns success", async () => {
    const result = await addToWishlist(initialWishlistState, formData());

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "guest@example.com",
        marketing_opt_in: true,
        opt_in_copy: WISHLIST_OPT_IN_COPY,
        source: "shop_wishlist",
      }),
      { onConflict: "email" },
    );
    expect(mockInsert).toHaveBeenCalledWith({
      email: "guest@example.com",
      product_slug: firstProduct.slug,
    });
    expect(mockUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mockInsert.mock.invocationCallOrder[0],
    );
  });

  it("takes the stored consent copy from the server, not the form", async () => {
    await addToWishlist(initialWishlistState, formData({ opt_in_copy: "something else" }));

    expect(mockUpsert.mock.calls[0][0].opt_in_copy).toBe(WISHLIST_OPT_IN_COPY);
  });

  it("treats an already-wished product as success", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const result = await addToWishlist(initialWishlistState, formData());

    expect(result.ok).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("rejects an unknown slug without touching the database", async () => {
    const result = await addToWishlist(
      initialWishlistState,
      formData({ productSlug: "does-not-exist" }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.productSlug).toBe("Unknown product");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an unticked opt-in without touching the database", async () => {
    const result = await addToWishlist(initialWishlistState, formData({ marketingOptIn: null }));

    expect(result.ok).toBe(false);
    expect(result.errors.marketingOptIn).toBe(WISHLIST_OPT_IN_HELPER);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot with success and writes nothing", async () => {
    const result = await addToWishlist(
      initialWishlistState,
      formData({ website: "https://spam.example" }),
    );

    expect(result.ok).toBe(true);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("does not store the wish when the consent upsert fails", async () => {
    mockUpsert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });

    const result = await addToWishlist(initialWishlistState, formData());

    expect(result.ok).toBe(false);
    expect(result.generalError).toBe(WISHLIST_ERROR_COPY);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("reports a non-duplicate item insert failure", async () => {
    mockInsert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });

    const result = await addToWishlist(initialWishlistState, formData());

    expect(result.ok).toBe(false);
    expect(result.generalError).toBe(WISHLIST_ERROR_COPY);
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("returns only the form state shape", async () => {
    const result = await addToWishlist(initialWishlistState, formData());

    expect(Object.keys(result).sort()).toEqual(
      ["attempt", "email", "errors", "generalError", "ok"].sort(),
    );
  });
});
