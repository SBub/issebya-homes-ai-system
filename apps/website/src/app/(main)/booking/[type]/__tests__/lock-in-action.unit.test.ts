import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCK_IN_PRICING } from "pricing";
import { fromCalendarDay } from "@/lib/date-utils";
import type { BookingFormState } from "../actions";

// --- Mocks (same setup as actions.unit.test.ts) ---

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
  headers: async () => new Map([["host", "home.issebya.com"]]),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

const mockGetAvailability = vi.fn();
vi.mock("@/lib/availability", () => ({
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
}));

vi.mock("@/lib/blog/posts", () => ({
  getPostBySlug: () => undefined,
}));

// --- Helpers ---

const NOW = new Date("2026-10-13T12:00:00Z");
const WEEK_PRICE = String(LOCK_IN_PRICING.weekPrice);

const validFormData = (personCount = "2") => {
  const fd = new FormData();
  fd.set("guestName", "Guest Example");
  fd.set("email", "guest@example.com");
  fd.set("countryId", "US");
  fd.set("localNumber", "4155552671");
  fd.set("personCount", personCount);
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

// First `from` call is checkAvailability's own-bookings query (no conflict),
// every later one is the pending-row insert.
function mockSupabaseWithInsert() {
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
  return mockInsert;
}

// --- Tests ---

describe("submitLockIn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mockGetAvailability.mockResolvedValue({ bookings: [], firstAvailable: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["a Sunday check-in", "2026-11-01", "2026-11-08"],
    ["a 6-night range", "2026-11-02", "2026-11-08"],
    ["an 8-night range", "2026-11-02", "2026-11-10"],
    ["a week before the first lock-in", "2026-10-26", "2026-11-02"],
  ])("rejects %s without touching Stripe or Supabase", async (_label, checkIn, checkOut) => {
    const { submitLockIn } = await import("../actions");
    const result = await submitLockIn("room1", checkIn, checkOut, initialState, validFormData());

    expect(result.success).toBe(false);
    expect(result.generalError).not.toBe("");
    expect(result.attempt).toBe(1);
    expect(result.values.guestName).toBe("Guest Example");
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockGetAvailability).not.toHaveBeenCalled();
  });

  it("rejects a week that has already started", async () => {
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
    const { submitLockIn } = await import("../actions");
    const result = await submitLockIn(
      "room1",
      "2026-11-16",
      "2026-11-23",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).not.toBe("");
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it.each(["1", "2"])(
    "creates one week-price line item and a pending row for %s person(s)",
    async (personCount) => {
      const mockInsert = mockSupabaseWithInsert();
      mockStripeSessionCreate.mockResolvedValue({
        id: "cs_test_lock_in",
        url: "https://checkout.stripe.com/pay/cs_test_lock_in",
      });

      const { submitLockIn } = await import("../actions");
      const result = await submitLockIn(
        "room1",
        "2026-11-02",
        "2026-11-09",
        initialState,
        validFormData(personCount),
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_lock_in");

      expect(mockStripeSessionCreate).toHaveBeenCalledOnce();
      const stripeArgs = mockStripeSessionCreate.mock.calls[0][0];
      expect(stripeArgs.line_items).toHaveLength(1);
      expect(stripeArgs.line_items[0].price_data.unit_amount).toBe(LOCK_IN_PRICING.weekPrice * 100);
      expect(stripeArgs.line_items[0].price_data.product_data.description).toMatch(/lock-in/);
      expect(stripeArgs.metadata).toEqual({
        roomType: "room1",
        checkIn: "2026-11-02",
        checkOut: "2026-11-09",
        personCount,
        email: "guest@example.com",
        nights: "7",
        basePrice: WEEK_PRICE,
        touristTax: "0",
        total: WEEK_PRICE,
        guestName: "Guest Example",
        phone: "+14155552671",
        whatsappOptIn: "false",
        source: "direct",
      });
      // The protocol follows NODE_ENV, so only the host and path are pinned.
      expect(stripeArgs.cancel_url).toMatch(/:\/\/home\.issebya\.com\/lock-in\/room1$/);
      expect(stripeArgs.success_url).toMatch(
        /:\/\/home\.issebya\.com\/booking\/confirmation\?session=\{CHECKOUT_SESSION_ID\}$/,
      );

      expect(mockInsert).toHaveBeenCalledOnce();
      expect(mockInsert.mock.calls[0][0]).toMatchObject({
        room_type: "room1",
        check_in: "2026-11-02",
        check_out: "2026-11-09",
        nights: 7,
        person_count: Number(personCount),
        tourist_tax: 0,
        base_price: LOCK_IN_PRICING.weekPrice,
        total_amount: LOCK_IN_PRICING.weekPrice,
        source: "direct",
        status: "pending",
      });
    },
  );

  it("rejects a valid week with a blocked night through the shared availability re-check", async () => {
    mockSupabaseWithInsert();
    mockGetAvailability.mockResolvedValue({
      bookings: [{ start: fromCalendarDay("2026-11-05"), end: fromCalendarDay("2026-11-06") }],
      firstAvailable: null,
    });

    const { submitLockIn } = await import("../actions");
    const result = await submitLockIn(
      "room1",
      "2026-11-02",
      "2026-11-09",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(false);
    expect(result.generalError).toMatch(/just booked by someone else/i);
    expect(result.blockedDates).not.toBeNull();
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });
});
