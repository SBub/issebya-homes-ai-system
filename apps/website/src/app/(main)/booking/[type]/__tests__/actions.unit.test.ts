import { addDays, format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingFormState } from "../actions";

// --- Mocks ---

const mockSupabaseFrom = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockSupabaseFrom }),
}));

const mockUpsertGuestContact = vi.fn().mockResolvedValue("guest-contact-id-123");

vi.mock("@/lib/shared/guest-contacts", () => ({
  upsertGuestContact: mockUpsertGuestContact,
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
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setContext: vi.fn(), setTag: vi.fn(), setExtra: vi.fn() }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "issebya.com"]]),
}));

const mockRevalidateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

const mockGetAvailability = vi.fn();
vi.mock("@/lib/availability", () => ({
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
}));

// --- Helpers ---

// Pinned "now" for these tests, so the "valid" fixture's dates stay valid
// forever instead of going stale like the hardcoded 2026-08-01 they replace
// (that date was in the past by the time this test suite was ported here,
// first to the /api/checkout/create route test, and now to this action —
// the route itself was deleted since the Server Action is its only caller).
const NOW = new Date("2025-06-01T12:00:00Z");

const checkInDate = addDays(NOW, 30);
const checkOutDate = addDays(NOW, 33);

const validFormData = () => {
  const fd = new FormData();
  fd.set("guestName", "Guest Example");
  fd.set("email", "guest@example.com");
  fd.set("countryId", "US");
  fd.set("localNumber", "4155552671");
  fd.set("personCount", "2");
  return fd;
};

const initialState = {
  attempt: 0,
  errors: {},
  generalError: "",
  values: {
    guestName: "",
    email: "",
    countryId: "",
    localNumber: "",
    whatsappOptIn: false,
  },
  blockedDates: null,
  success: false,
  url: null,
  guestContactId: null,
} satisfies BookingFormState;

// --- Tests ---

describe("submitBooking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    // checkAvailability now re-checks the merged iCal + own-bookings calendar
    // on every submit, so every test needs this to resolve. Default is
    // "nothing blocked"; the tests that care override it.
    mockGetAvailability.mockResolvedValue({ bookings: [], firstAvailable: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns field errors for invalid contact fields", async () => {
    const { submitBooking } = await import("../actions");
    const fd = new FormData();
    fd.set("guestName", "");
    fd.set("email", "not-an-email");
    fd.set("countryId", "US");
    fd.set("localNumber", "");
    fd.set("personCount", "1");

    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      fd,
    );

    expect(result.success).toBe(false);
    expect(result.errors.email).toBeDefined();
    expect(result.errors.guestName).toBeDefined();
    expect(result.errors.localNumber).toBeDefined();
  });

  it("returns a general error when check-in is in the past", async () => {
    const { submitBooking } = await import("../actions");
    const past = new Date("2020-01-01");
    const pastOut = new Date("2020-01-03");

    const result = await submitBooking(
      "room1",
      past,
      pastOut,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toBe("Check-in date cannot be in the past");
  });

  it("returns dates_unavailable-shaped state with fresh blocked dates on conflict", async () => {
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
    mockGetAvailability.mockResolvedValue({
      bookings: [{ start: new Date("2025-07-01"), end: new Date("2025-07-03") }],
      firstAvailable: null,
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toMatch(/just booked by someone else/i);
    expect(result.blockedDates).toEqual([
      { start: new Date("2025-07-01"), end: new Date("2025-07-03") },
    ]);
  });

  // The `bookings` table only ever holds our own rows, so this is the
  // regression guard for the double-booking hole: a night blocked purely by an
  // Airbnb/VRBO/Booking.com reservation used to pass the server check and get a
  // Stripe session created against it.
  it("rejects a range blocked only by an iCal feed, with no conflicting own booking", async () => {
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
    // Overlaps the requested 2025-07-01 -> 2025-07-04 stay.
    mockGetAvailability.mockResolvedValue({
      bookings: [{ start: new Date("2025-07-02"), end: new Date("2025-07-05") }],
      firstAvailable: null,
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toMatch(/just booked by someone else/i);
    expect(result.blockedDates).toEqual([
      { start: new Date("2025-07-02"), end: new Date("2025-07-05") },
    ]);
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  // A cached read could still miss an OTA booking made minutes ago, which is
  // the race the iCal re-check exists to close.
  it("expires the availability cache tag before re-reading it at submit time", async () => {
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
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockStripeSessionCreate.mockResolvedValue({
      id: "cs_test_789",
      url: "https://checkout.stripe.com/pay/cs_test_789",
    });

    const { submitBooking } = await import("../actions");
    await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(mockRevalidateTag).toHaveBeenCalledWith("availability-room1", { expire: 0 });
    expect(mockGetAvailability).toHaveBeenCalledWith("room1");
  });

  // Outage policy: a feed that did not answer must never open a
  // double-booking hole. Fall back to the last known good snapshot, and
  // refuse outright only when no complete picture exists at all.
  it("refuses the booking when no complete feed data is available at all", async () => {
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
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockGetAvailability.mockResolvedValue({
      bookings: [],
      firstAvailable: null,
      error: "Some availability data could not be fetched: 1 feed(s) failed.",
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toContain("could not confirm availability");
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  it("blocks a stay the failed feed no longer reports but the last known good snapshot does", async () => {
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
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    // Cached read (last known good) is complete and shows the stay blocked.
    mockGetAvailability.mockResolvedValueOnce({
      bookings: [{ start: new Date("2025-07-02"), end: new Date("2025-07-05") }],
      firstAvailable: null,
    });
    // Fresh read lost that feed, so it looks free.
    mockGetAvailability.mockResolvedValueOnce({
      bookings: [],
      firstAvailable: null,
      error: "Some availability data could not be fetched: 1 feed(s) failed.",
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toContain("just booked by someone else");
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  it("proceeds when a feed failed but the last known good snapshot leaves the stay free", async () => {
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
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockGetAvailability.mockResolvedValueOnce({ bookings: [], firstAvailable: null });
    mockGetAvailability.mockResolvedValueOnce({
      bookings: [],
      firstAvailable: null,
      error: "Some availability data could not be fetched: 1 feed(s) failed.",
    });
    mockStripeSessionCreate.mockResolvedValue({
      id: "cs_test_degraded",
      url: "https://checkout.stripe.com/pay/cs_test_degraded",
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_degraded");
  });

  it("returns a checkout URL on success", async () => {
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

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_123");
    expect(result.guestContactId).toBe("guest-contact-id-123");

    // Verify Stripe was called with correct metadata
    expect(mockStripeSessionCreate).toHaveBeenCalledOnce();
    const stripeArgs = mockStripeSessionCreate.mock.calls[0][0];
    expect(stripeArgs.metadata.roomType).toBe("room1");
    expect(stripeArgs.metadata.checkIn).toBe(format(checkInDate, "yyyy-MM-dd"));
    expect(stripeArgs.metadata.checkOut).toBe(format(checkOutDate, "yyyy-MM-dd"));
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
      return { insert: mockInsert };
    });

    mockStripeSessionCreate.mockResolvedValue({
      id: "cs_test_456",
      url: "https://checkout.stripe.com/pay/cs_test_456",
    });

    const { submitBooking } = await import("../actions");
    await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertData = mockInsert.mock.calls[0][0];
    expect(insertData.room_type).toBe("room1");
    expect(insertData.status).toBe("pending");
    expect(insertData.stripe_session_id).toBe("cs_test_456");
    expect(insertData.guest_contact_id).toBe("guest-contact-id-123");
  });

  it("returns a general error when Stripe throws", async () => {
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

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toBe("Failed to create checkout session");
  });

  it("echoes back submitted values on every non-success result, keyed by an incrementing attempt", async () => {
    const { submitBooking } = await import("../actions");
    const fd = new FormData();
    fd.set("guestName", "");
    fd.set("email", "not-an-email");
    fd.set("countryId", "US");
    fd.set("localNumber", "");
    fd.set("personCount", "1");

    const result = await submitBooking(
      "room1",
      checkInDate,
      checkOutDate,
      "direct",
      initialState,
      fd,
    );

    expect(result.attempt).toBe(1);
    expect(result.values).toEqual({
      guestName: "",
      email: "not-an-email",
      countryId: "US",
      localNumber: "",
      whatsappOptIn: false,
    });

    const second = await submitBooking("room1", checkInDate, checkOutDate, "direct", result, fd);
    expect(second.attempt).toBe(2);
  });
});
