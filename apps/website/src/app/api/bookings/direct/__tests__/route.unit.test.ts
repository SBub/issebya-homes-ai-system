import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockSupabaseFrom = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockSupabaseFrom }),
}));

const mockUpsertGuestContact = vi.fn().mockResolvedValue("guest-contact-id-123");

vi.mock("@/lib/shared/guest-contacts", () => ({
  upsertGuestContact: mockUpsertGuestContact,
}));

const mockStripeRetrieve = vi.fn();

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: { retrieve: mockStripeRetrieve },
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
}));

const mockRevalidateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

// --- Helpers ---

function makeRequest(sessionId?: string): NextRequest {
  const url = sessionId
    ? `https://issebya.com/api/bookings/direct?session=${sessionId}`
    : "https://issebya.com/api/bookings/direct";
  return new NextRequest(url);
}

type BookingRow = {
  access_token: string;
  room_type: string;
  check_in: string;
  check_out: string;
  nights: number;
  person_count: number;
  base_price: number;
  tourist_tax: number;
  total_amount: number;
  status: string;
  created_at: string;
  confirmed_at?: string | null;
  guest_email_sent_at?: string | null;
  owner_email_sent_at?: string | null;
  guest_contacts: { email: string } | null;
};

const baseBooking: BookingRow = {
  access_token: "tok_abc123",
  room_type: "room1",
  check_in: "2025-07-01",
  check_out: "2025-07-03",
  nights: 2,
  person_count: 2,
  base_price: 195,
  tourist_tax: 12,
  total_amount: 207,
  status: "pending",
  created_at: "2025-06-01T12:00:00Z",
  guest_contacts: { email: "guest@example.com" },
};

/**
 * The initial lookup (`.select(...).eq(...).in(...).single()`) is always the
 * first `from("bookings")` call in the GET handler. The recovery-path update
 * (`.update(...).eq(...).eq(...)`, no further chaining — its result is
 * awaited directly) is the second, only reached when the booking is
 * "pending" and Stripe reports it as paid. The Stripe-fallback insert
 * (`.insert(...).select(...).single()`) is the second call instead when the
 * lookup finds no row.
 */
function setupSupabaseMocks(
  initialBooking: BookingRow | null,
  initialError: { message: string } | null = null,
  updateError: { message: string } | null = null,
) {
  let callCount = 0;
  mockSupabaseFrom.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: initialBooking, error: initialError }),
            }),
          }),
        }),
      };
    }
    return {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: updateError }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { ...baseBooking, status: "confirmed" },
            error: null,
          }),
        }),
      }),
    };
  });
}

const ISO_TIMESTAMP = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

// --- Tests ---

describe("GET /api/bookings/direct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when session query param is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("does not invalidate the cache when the booking is already confirmed", async () => {
    setupSupabaseMocks({ ...baseBooking, status: "confirmed" });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(200);
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("invalidates the availability cache tag when recovering a pending booking to confirmed", async () => {
    setupSupabaseMocks({ ...baseBooking, status: "pending" });
    mockStripeRetrieve.mockResolvedValue({ payment_status: "paid" });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking.status).toBe("confirmed");

    expect(mockRevalidateTag).toHaveBeenCalledWith("availability-room1", { expire: 0 });
    expect(mockRevalidateTag).toHaveBeenCalledOnce();
  });

  it("does not invalidate the cache when the recovery update fails", async () => {
    setupSupabaseMocks({ ...baseBooking, status: "pending" }, null, {
      message: "update failed",
    });
    mockStripeRetrieve.mockResolvedValue({ payment_status: "paid" });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(500);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("does not invalidate the cache when payment is not completed", async () => {
    setupSupabaseMocks({ ...baseBooking, status: "pending" });
    mockStripeRetrieve.mockResolvedValue({ payment_status: "unpaid" });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(402);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("does not invalidate the cache when the Stripe retrieve call throws", async () => {
    setupSupabaseMocks({ ...baseBooking, status: "pending" });
    mockStripeRetrieve.mockRejectedValue(new Error("Stripe is down"));

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(500);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("stamps confirmed_at when recovering a pending booking to confirmed", async () => {
    setupSupabaseMocks({
      ...baseBooking,
      status: "pending",
      confirmed_at: null,
      guest_email_sent_at: null,
      owner_email_sent_at: null,
    });
    mockStripeRetrieve.mockResolvedValue({ payment_status: "paid" });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(200);
    const updateFn = mockSupabaseFrom.mock.results[1].value.update;
    expect(updateFn).toHaveBeenCalledWith({ status: "confirmed", confirmed_at: ISO_TIMESTAMP });

    // The page seeds its timeline from this response, so the in-memory row
    // must carry the same timestamp the update wrote.
    const json = await res.json();
    expect(json.booking.confirmed_at).toBe(updateFn.mock.calls[0][0].confirmed_at);
    expect(json.booking.access_token).toBe("tok_abc123");
  });

  it("stamps confirmed_at on the Stripe-fallback insert", async () => {
    setupSupabaseMocks(null, { message: "No rows found" });
    mockStripeRetrieve.mockResolvedValue({
      payment_status: "paid",
      metadata: {
        roomType: "room1",
        checkIn: "2025-07-01",
        checkOut: "2025-07-03",
        nights: "2",
        personCount: "2",
        basePrice: "195",
        touristTax: "12",
        total: "207",
        email: "guest@example.com",
        phone: "+14155552671",
        guestName: "Guest Example",
      },
    });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("cs_test_123"));

    expect(res.status).toBe(200);
    const insertFn = mockSupabaseFrom.mock.results[1].value.insert;
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", confirmed_at: ISO_TIMESTAMP }),
    );
  });
});
