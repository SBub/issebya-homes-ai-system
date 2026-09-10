import { addDays } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";
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

// The action takes calendar days, not instants: the browser labels the dates
// the guest picked and the server only ever sees the labels.
const checkInDay = toCalendarDay(addDays(NOW, 30));
const checkOutDay = toCalendarDay(addDays(NOW, 33));

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
      checkInDay,
      checkOutDay,
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
    const past = "2020-01-01";
    const pastOut = "2020-01-03";

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
      bookings: [{ start: fromCalendarDay("2025-07-01"), end: fromCalendarDay("2025-07-03") }],
      firstAvailable: null,
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDay,
      checkOutDay,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toMatch(/just booked by someone else/i);
    expect(result.blockedDates).toEqual([
      { start: fromCalendarDay("2025-07-01"), end: fromCalendarDay("2025-07-03") },
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
      bookings: [{ start: fromCalendarDay("2025-07-02"), end: fromCalendarDay("2025-07-05") }],
      firstAvailable: null,
    });

    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      checkInDay,
      checkOutDay,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toMatch(/just booked by someone else/i);
    expect(result.blockedDates).toEqual([
      { start: fromCalendarDay("2025-07-02"), end: fromCalendarDay("2025-07-05") },
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
    await submitBooking("room1", checkInDay, checkOutDay, "direct", initialState, validFormData());

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
      checkInDay,
      checkOutDay,
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
      bookings: [{ start: fromCalendarDay("2025-07-02"), end: fromCalendarDay("2025-07-05") }],
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
      checkInDay,
      checkOutDay,
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
      checkInDay,
      checkOutDay,
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
      checkInDay,
      checkOutDay,
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
    expect(stripeArgs.metadata.checkIn).toBe(checkInDay);
    expect(stripeArgs.metadata.checkOut).toBe(checkOutDay);
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
    await submitBooking("room1", checkInDay, checkOutDay, "direct", initialState, validFormData());

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
      checkInDay,
      checkOutDay,
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
      checkInDay,
      checkOutDay,
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

    const second = await submitBooking("room1", checkInDay, checkOutDay, "direct", result, fd);
    expect(second.attempt).toBe(2);
  });
});

// A calendar day is a label, not a moment, and this whole class of bug is
// invisible when the "browser" and the test process share a timezone. These
// tests therefore run the browser-side conversion under an explicitly set TZ
// and the action itself under a different one, so a server that re-interprets
// the guest's day would be caught.
//
// Node re-reads process.env.TZ on the next Date operation, so mutating it here
// really does move the process's local calendar.
function withTimezone<T>(timeZone: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    restoreTimezone(original);
  }
}

// The async twin. Restoring in a synchronous finally would put the timezone
// back the moment the action hit its first await, leaving most of the action
// running under the ambient timezone instead of the pinned one. Tests in a
// file run one at a time, so holding the process timezone across an await is
// safe here.
async function withTimezoneAsync<T>(timeZone: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return await fn();
  } finally {
    restoreTimezone(original);
  }
}

function restoreTimezone(original: string | undefined): void {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
}

// Everything a real browser does between the guest's click and the Server
// Action call: build the Date at the guest's local midnight, then label it.
function guestPicks(timeZone: string, day: string): { instant: Date; label: string } {
  return withTimezone(timeZone, () => {
    const [year, month, date] = day.split("-").map(Number);
    const instant = new Date(year, month - 1, date);
    return { instant, label: toCalendarDay(instant) };
  });
}

describe("submitBooking records the guest's own calendar day", () => {
  const CHECK_IN_DAY = "2026-09-21";
  const CHECK_OUT_DAY = "2026-09-24";

  let mockInsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mockGetAvailability.mockResolvedValue({ bookings: [], firstAvailable: null });
    mockInsert = vi.fn().mockResolvedValue({ error: null });

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
      id: "cs_test_tz",
      url: "https://checkout.stripe.com/pay/cs_test_tz",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Europe/Lisbon and Europe/Berlin are ahead of UTC in September, so their
  // local midnight is still the previous day in UTC. That is the direction
  // that used to shift. America/New_York is behind UTC and never shifted, so
  // it is here to prove the fix did not invert the bug.
  it.each([
    ["Europe/Lisbon", "2026-09-20", true],
    ["Europe/Berlin", "2026-09-20", true],
    ["America/New_York", "2026-09-21", false],
  ])(
    "stores the picked day for a guest in %s, whose click lands on UTC %s",
    async (guestTimeZone, utcDayOfClick, shifts) => {
      const checkIn = guestPicks(guestTimeZone, CHECK_IN_DAY);
      const checkOut = guestPicks(guestTimeZone, CHECK_OUT_DAY);

      // Guards against a vacuous test: for the ahead-of-UTC guests the instant
      // their browser produced really does fall on the previous UTC day, which
      // is exactly the day the old server-side format() recorded.
      expect(checkIn.instant.toISOString().slice(0, 10)).toBe(utcDayOfClick);
      expect(utcDayOfClick !== CHECK_IN_DAY).toBe(shifts);

      // The browser labels the day; the server only ever sees the label.
      expect(checkIn.label).toBe(CHECK_IN_DAY);
      expect(checkOut.label).toBe(CHECK_OUT_DAY);

      const { submitBooking } = await import("../actions");
      // Vercel runs UTC. The old code formatted the guest's instant here.
      const result = await withTimezoneAsync("UTC", () =>
        submitBooking(
          "room1",
          checkIn.label,
          checkOut.label,
          "direct",
          initialState,
          validFormData(),
        ),
      );

      expect(result.success).toBe(true);

      expect(mockInsert).toHaveBeenCalledOnce();
      expect(mockInsert.mock.calls[0][0].check_in).toBe(CHECK_IN_DAY);
      expect(mockInsert.mock.calls[0][0].check_out).toBe(CHECK_OUT_DAY);

      const stripeArgs = mockStripeSessionCreate.mock.calls[0][0];
      expect(stripeArgs.metadata.checkIn).toBe(CHECK_IN_DAY);
      expect(stripeArgs.metadata.checkOut).toBe(CHECK_OUT_DAY);
      // The guest-facing label on the Stripe line item, loose on the month
      // abbreviation ("Sep" vs "Sept") since that is ICU's call, not ours.
      expect(stripeArgs.line_items[0].price_data.product_data.name).toMatch(/\b21 Sept? 2026\b/);
      expect(stripeArgs.line_items[0].price_data.product_data.name).toMatch(/\b24 Sept? 2026\b/);
    },
  );

  // The point of passing labels rather than instants: whatever timezone the
  // server happens to run in, it cannot re-derive a different day.
  it.each(["UTC", "Europe/Lisbon", "Asia/Tokyo", "America/New_York"])(
    "stores the same day with the server running in %s",
    async (serverTimeZone) => {
      const { submitBooking } = await import("../actions");
      const result = await withTimezoneAsync(serverTimeZone, () =>
        submitBooking(
          "room1",
          CHECK_IN_DAY,
          CHECK_OUT_DAY,
          "direct",
          initialState,
          validFormData(),
        ),
      );

      expect(result.success).toBe(true);
      expect(mockInsert.mock.calls[0][0].check_in).toBe(CHECK_IN_DAY);
      expect(mockInsert.mock.calls[0][0].check_out).toBe(CHECK_OUT_DAY);
      expect(mockInsert.mock.calls[0][0].nights).toBe(3);
    },
  );

  it.each([
    ["a malformed day", "21-09-2026"],
    ["a day that is not on the calendar", "2026-02-31"],
    ["an instant rather than a day", "2026-09-21T00:00:00.000Z"],
  ])("rejects %s without creating a Stripe session", async (_label, badDay) => {
    const { submitBooking } = await import("../actions");
    const result = await submitBooking(
      "room1",
      badDay,
      CHECK_OUT_DAY,
      "direct",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.errors.checkIn).toBeDefined();
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
