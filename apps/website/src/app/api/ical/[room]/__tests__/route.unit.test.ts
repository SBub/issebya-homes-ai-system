import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createClient: () => ({ from: mockFrom }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// --- Helpers ---

type BookingRow = {
  id: string;
  check_in: string;
  check_out: string;
  created_at: string;
};

type QueryResult = { data: BookingRow[] | null; error: { message: string } | null };

type QueryChain = PromiseLike<QueryResult> & { eq: typeof mockEq };

const baseBooking: BookingRow = {
  id: "11111111-2222-3333-4444-555555555555",
  check_in: "2026-09-21",
  check_out: "2026-09-24",
  created_at: "2026-09-01T12:00:00Z",
};

/**
 * The handler awaits the result of the LAST `.eq(...)` in the chain. The mock
 * chain is deliberately permissive: every `.eq()` returns a thenable that also
 * exposes `.eq`, so a re-added `.eq("status", "confirmed")` would still resolve
 * here. What catches that regression is the assertion on `mockEq.mock.calls`,
 * not the shape of the mock. `booking_availability` is a view that does not
 * project `status`, so filtering on it makes PostgREST reject the query.
 */
function setupSupabaseMocks(result: QueryResult) {
  const chain = {
    eq: mockEq,
    then: (
      onfulfilled?: ((value: QueryResult) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  } as QueryChain;

  mockEq.mockReturnValue(chain);
  mockSelect.mockReturnValue(chain);
  mockFrom.mockReturnValue({ select: mockSelect });
}

function makeRequest(room: string): NextRequest {
  return new NextRequest(`https://issebya.com/api/ical/${room}`);
}

function makeParams(room: string) {
  return { params: Promise.resolve({ room }) };
}

// --- Tests ---

describe("GET /api/ical/[room]", () => {
  // Pay the route's cold module-graph transform once here rather than inside
  // whichever test happens to import it first, where it eats that test's
  // 5s budget and fails it for reasons unrelated to what it asserts.
  beforeAll(async () => {
    await import("../route");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a room outside the allow-list without touching the database", async () => {
    setupSupabaseMocks({ data: [], error: null });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("room3"), makeParams("room3"));

    expect(res.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("filters the availability view by room only, never by status", async () => {
    setupSupabaseMocks({ data: [baseBooking], error: null });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("room1"), makeParams("room1"));

    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("booking_availability");
    expect(mockSelect).toHaveBeenCalledWith("id, check_in, check_out, created_at");

    // The view already applies `where status = 'confirmed'` and does not
    // project `status`. Any filter on it would be rejected as an undefined
    // column (42703), the feed would 500, and the OTAs would see no blocked
    // dates: a double-booking risk.
    const filteredColumns = mockEq.mock.calls.map(([column]) => column);
    expect(filteredColumns).not.toContain("status");
    expect(mockEq.mock.calls).toEqual([["room_type", "room1"]]);
  });

  it("returns a text/calendar feed containing the confirmed booking", async () => {
    setupSupabaseMocks({ data: [baseBooking], error: null });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("room2"), makeParams("room2"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="room2.ics"');

    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("DTSTART;VALUE=DATE:20260921");
    expect(body).toContain("DTEND;VALUE=DATE:20260924");
    expect(body).toContain(`UID:${baseBooking.id}@issebya.homes`);
    expect(body).toContain("END:VCALENDAR");
  });

  it("returns an empty but well-formed calendar when the room has no bookings", async () => {
    setupSupabaseMocks({ data: [], error: null });

    const { GET } = await import("../route");
    const res = await GET(makeRequest("room1"), makeParams("room1"));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
  });

  it("returns 500 when the availability query fails", async () => {
    setupSupabaseMocks({ data: null, error: { message: "boom" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const res = await GET(makeRequest("room1"), makeParams("room1"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch bookings" });

    // An OTA poller reads a 500 as "no update" and keeps serving the last
    // feed it saw, so this failure is invisible from the outside. Sentry is
    // the only thing that makes it visible.
    expect(mockCaptureException).toHaveBeenCalledWith(
      { message: "boom" },
      { tags: { "db.operation": "ical_feed_fetch", "booking.roomType": "room1" } },
    );

    consoleError.mockRestore();
  });

  it("reports to Sentry when feed generation throws on an unparseable row", async () => {
    // Real generator, real failure: generateICalFeed runs created_at through
    // date-fns `format`, which throws RangeError on an Invalid Date. No stub,
    // so this stays honest about what the route actually does with bad data.
    setupSupabaseMocks({ data: [{ ...baseBooking, created_at: "not-a-date" }], error: null });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const res = await GET(makeRequest("room1"), makeParams("room1"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to generate iCal feed" });
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { "ical.operation": "generate_feed", "booking.roomType": "room1" },
        extra: { bookingCount: 1 },
      }),
    );

    consoleError.mockRestore();
  });
});
