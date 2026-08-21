import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockSupabaseFrom = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockSupabaseFrom }),
}));

const mockStripeSessionCreate = vi.fn();

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: { create: mockStripeSessionCreate },
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

// --- Helpers ---

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://issebya.com/api/checkout/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  roomType: "room1",
  checkIn: "2026-08-01",
  checkOut: "2026-08-04",
  personCount: 2,
  email: "guest@example.com",
};

// --- Tests ---

describe("POST /api/checkout/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid body (validation errors)", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({ roomType: "invalid" });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect(json.errors).toBeDefined();
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it("returns 400 when check-in is in the past", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({
      ...validBody,
      checkIn: "2020-01-01",
      checkOut: "2020-01-03",
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Check-in date cannot be in the past");
  });

  it("returns 409 when dates are unavailable", async () => {
    // Supabase returns a conflicting booking
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              gt: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "existing-booking" }],
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const { POST } = await import("../route");
    const req = makeRequest(validBody);
    const res = await POST(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("dates_unavailable");
  });

  it("returns checkout URL on success", async () => {
    // No conflicts
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              gt: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        // biome-ignore lint/suspicious/noThenProperty: mocks Supabase's real thenable PostgrestFilterBuilder
        then: (fn: (v: unknown) => void) => fn({ error: null }),
      }),
    });

    mockStripeSessionCreate.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });

    const { POST } = await import("../route");
    const req = makeRequest(validBody);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://checkout.stripe.com/pay/cs_test_123");

    // Verify Stripe was called with correct metadata
    expect(mockStripeSessionCreate).toHaveBeenCalledOnce();
    const stripeArgs = mockStripeSessionCreate.mock.calls[0][0];
    expect(stripeArgs.metadata.roomType).toBe("room1");
    expect(stripeArgs.metadata.checkIn).toBe("2026-08-01");
    expect(stripeArgs.metadata.checkOut).toBe("2026-08-04");
    expect(stripeArgs.metadata.personCount).toBe("2");
    expect(stripeArgs.metadata.email).toBe("guest@example.com");
    expect(stripeArgs.customer_email).toBe("guest@example.com");
    expect(stripeArgs.line_items).toHaveLength(2);
  });

  it("creates a pending booking in the database", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // availability check
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [] }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      // insert call
      return { insert: mockInsert };
    });

    mockStripeSessionCreate.mockResolvedValue({
      id: "cs_test_456",
      url: "https://checkout.stripe.com/pay/cs_test_456",
    });

    const { POST } = await import("../route");
    const req = makeRequest(validBody);
    await POST(req);

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertData = mockInsert.mock.calls[0][0];
    expect(insertData.room_type).toBe("room1");
    expect(insertData.status).toBe("pending");
    expect(insertData.stripe_session_id).toBe("cs_test_456");
    expect(insertData.email).toBe("guest@example.com");
  });

  it("returns 500 when Stripe throws", async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              gt: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          }),
        }),
      }),
    });

    mockStripeSessionCreate.mockRejectedValue(new Error("Stripe is down"));

    const { POST } = await import("../route");
    const req = makeRequest(validBody);
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to create checkout session");
  });
});
