import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory fake of the Supabase query builder ---
//
// The fake honours every recorded filter, so a claim without
// `.is("pre_arrival_email_sent_at", null)` really does match a row twice.
// That is what makes the concurrency test meaningful: it fails if the route
// drops the predicate. Queries resolve after a macrotask, so two concurrent
// invocations interleave the way two cron deliveries would.

type Row = {
  id: string;
  room_type: string;
  check_in: string;
  check_out: string;
  status: string;
  pre_arrival_email_sent_at: string | null;
  guest_contacts: { guest_name: string | null; email: string | null };
};

type Filter = (row: Row) => boolean;
type QueryError = { message: string };

let rows: Row[] = [];
let failNext: QueryError | null = null;
let afterSelect: (() => void) | null = null;
let dbCalls = 0;

function builder() {
  const filters: Filter[] = [];
  let update: Partial<Row> | null = null;

  const run = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (failNext) {
      const error = failNext;
      failNext = null;
      return { data: null, error };
    }
    const matched = rows.filter((row) => filters.every((f) => f(row)));
    if (update) {
      for (const row of matched) Object.assign(row, update);
      return { data: matched.map((row) => ({ id: row.id })), error: null };
    }
    const data = matched.map((row) => structuredClone(row));
    afterSelect?.();
    return { data, error: null };
  };

  const chain = {
    select: () => chain,
    update: (values: Partial<Row>) => {
      update = values;
      return chain;
    },
    eq: (column: keyof Row, value: unknown) => {
      filters.push((row) => row[column] === value);
      return chain;
    },
    is: (column: keyof Row, value: null) => {
      filters.push((row) => row[column] === value);
      return chain;
    },
    gte: (column: keyof Row, value: string) => {
      filters.push((row) => (row[column] as string) >= value);
      return chain;
    },
    lte: (column: keyof Row, value: string) => {
      filters.push((row) => (row[column] as string) <= value);
      return chain;
    },
    then: <T>(onfulfilled: (value: Awaited<ReturnType<typeof run>>) => T) =>
      run().then(onfulfilled),
  };
  return chain;
}

const fakeClient = {
  from: (table: string) => {
    expect(table).toBe("bookings");
    dbCalls += 1;
    return builder();
  },
};

// --- Mocks ---

const mockSend = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => fakeClient,
}));

vi.mock("@/lib/resend", () => ({
  sendPreArrivalEmail: (...args: unknown[]) => mockSend(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// --- Helpers ---

const SECRET = "test-secret-1234567890";

function booking(overrides: Partial<Row> & { id: string }): Row {
  return {
    room_type: "room1",
    check_in: "2026-10-01",
    check_out: "2026-10-04",
    status: "confirmed",
    pre_arrival_email_sent_at: null,
    guest_contacts: { guest_name: "Anna Silva", email: "anna@example.com" },
    ...overrides,
  };
}

function makeRequest({
  auth = `Bearer ${SECRET}`,
  query = "",
}: { auth?: string | null; query?: string } = {}) {
  const headers = auth === null ? undefined : { authorization: auth };
  return new NextRequest(`https://issebya.com/api/cron/pre-arrival${query}`, { headers });
}

async function callRoute(request = makeRequest()) {
  const { GET } = await import("../route");
  const response = await GET(request);
  return { status: response.status, body: await response.json() };
}

// --- Tests ---

describe("GET /api/cron/pre-arrival", () => {
  beforeAll(async () => {
    await import("../route");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    // Only Date is faked; setTimeout stays real so the fake DB can yield.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    vi.stubEnv("CRON_SECRET", SECRET);
    rows = [];
    failNext = null;
    afterSelect = null;
    dbCalls = 0;
    mockSend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects a request without an Authorization header", async () => {
    rows = [booking({ id: "b1" })];
    const { status } = await callRoute(makeRequest({ auth: null }));
    expect(status).toBe(401);
    expect(dbCalls).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token", async () => {
    const { status } = await callRoute(makeRequest({ auth: "Bearer nope" }));
    expect(status).toBe(401);
    expect(dbCalls).toBe(0);
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { status, body } = await callRoute();
    expect(status).toBe(500);
    expect(body.error).toBe("CRON_SECRET is not set; refusing to run");
    expect(dbCalls).toBe(0);
  });

  it("lists candidates with masked emails on a dry run, without claiming or sending", async () => {
    rows = [booking({ id: "b1" })];
    const { status, body } = await callRoute(makeRequest({ query: "?dryRun=1" }));

    expect(status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.candidates).toEqual([
      { bookingId: "b1", checkIn: "2026-10-01", email: "a***@example.com" },
    ]);
    expect(JSON.stringify(body)).not.toContain("anna@example.com");
    expect(mockSend).not.toHaveBeenCalled();
    expect(rows[0].pre_arrival_email_sent_at).toBeNull();
  });

  it("sends a due booking and records the send", async () => {
    rows = [booking({ id: "b1" })];
    const { status, body } = await callRoute();

    expect(status).toBe(200);
    expect(body).toEqual({
      sent: [{ bookingId: "b1", checkIn: "2026-10-01" }],
      skipped: [],
      failed: [],
    });
    expect(mockSend).toHaveBeenCalledExactlyOnceWith({
      email: "anna@example.com",
      guestName: "Anna Silva",
      roomType: "room1",
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
    });
    expect(rows[0].pre_arrival_email_sent_at).not.toBeNull();
  });

  it("leaves out non-due bookings and reports check-in today as too late", async () => {
    rows = [
      booking({ id: "pending", check_in: "2026-09-30", status: "pending" }),
      booking({ id: "cancelled", check_in: "2026-09-30", status: "cancelled" }),
      booking({ id: "sent", pre_arrival_email_sent_at: "2026-09-28T07:05:00Z" }),
      booking({ id: "later", check_in: "2026-10-02" }),
      booking({ id: "today", check_in: "2026-09-29" }),
    ];
    const { body } = await callRoute();

    expect(mockSend).not.toHaveBeenCalled();
    expect(body).toEqual({
      sent: [],
      skipped: [{ bookingId: "today", checkIn: "2026-09-29", reason: "too_late" }],
      failed: [],
    });
  });

  it("skips a booking another invocation claimed after the select", async () => {
    rows = [booking({ id: "b1" })];
    afterSelect = () => {
      rows[0].pre_arrival_email_sent_at = "2026-09-29T07:00:00Z";
    };
    const { body } = await callRoute();

    expect(mockSend).not.toHaveBeenCalled();
    expect(body.skipped).toEqual([
      { bookingId: "b1", checkIn: "2026-10-01", reason: "already_claimed" },
    ]);
  });

  it("releases the claim and reports a failed send", async () => {
    rows = [booking({ id: "b1" })];
    mockSend.mockRejectedValueOnce(new Error("boom"));
    const { body } = await callRoute();

    expect(body.failed).toEqual([{ bookingId: "b1", checkIn: "2026-10-01", error: "boom" }]);
    expect(body.sent).toEqual([]);
    expect(mockCaptureException).toHaveBeenCalled();
    expect(rows[0].pre_arrival_email_sent_at).toBeNull();
  });

  it("sends once when two invocations run concurrently", async () => {
    rows = [booking({ id: "b1" })];
    const [first, second] = await Promise.all([callRoute(), callRoute()]);

    expect(mockSend).toHaveBeenCalledOnce();
    const outcomes = [first.body, second.body];
    expect(outcomes.flatMap((b) => b.sent)).toEqual([{ bookingId: "b1", checkIn: "2026-10-01" }]);
    expect(outcomes.flatMap((b) => b.skipped)).toEqual([
      { bookingId: "b1", checkIn: "2026-10-01", reason: "already_claimed" },
    ]);
  });

  it("returns 500 and reports to Sentry when the select fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failNext = { message: "connection refused" };
    const { status } = await callRoute();

    expect(status).toBe(500);
    expect(mockCaptureException).toHaveBeenCalled();
  });

  it("never logs a guest's email", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rows = [booking({ id: "b1" }), booking({ id: "today", check_in: "2026-09-29" })];
    mockSend.mockRejectedValueOnce(new Error("boom"));
    await callRoute();

    expect(log).toHaveBeenCalled();
    for (const args of log.mock.calls) {
      expect(JSON.stringify(args)).not.toContain("anna@example.com");
    }
    log.mockRestore();
  });
});
