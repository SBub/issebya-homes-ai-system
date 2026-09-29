import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockSupabaseFrom = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockSupabaseFrom }),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  captureException: vi.fn(),
}));

// --- Helpers ---

const TOKEN = "a".repeat(64);
const AT = "2026-09-29T10:00:00.000Z";

type Row = {
  status: string;
  confirmed_at: string | null;
  guest_email_sent_at: string | null;
  owner_email_sent_at: string | null;
};

type QueryResult = { data: Row | null; error: { message: string } | null };

const pending: Row = {
  status: "pending",
  confirmed_at: null,
  guest_email_sent_at: null,
  owner_email_sent_at: null,
};
const confirmed: Row = { ...pending, status: "confirmed", confirmed_at: AT };
const guestSent: Row = { ...confirmed, guest_email_sent_at: AT };
const allSet: Row = { ...guestSent, owner_email_sent_at: AT };

/**
 * Every `from("bookings")` call is one `select(...).eq(...).in(...).maybeSingle()`
 * read: the initial lookup first, then one per poll tick. Results are served
 * in order; once the queue runs out the last one repeats.
 */
function queueReads(...results: QueryResult[]) {
  let index = 0;
  mockSupabaseFrom.mockImplementation(() => {
    const result = results[Math.min(index, results.length - 1)];
    index++;
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    };
  });
}

const row = (data: Row): QueryResult => ({ data, error: null });

function makeRequest(
  token = TOKEN,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return new NextRequest(`https://issebya.com/api/bookings/${token}/events`, init);
}

async function callGet(token = TOKEN, init?: Parameters<typeof makeRequest>[1]) {
  const { GET } = await import("../route");
  return GET(makeRequest(token, init), { params: Promise.resolve({ token }) });
}

/** Drains the body in the background so each assertion sees what has arrived so far. */
function collect(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const state = { text: "", closed: false };
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        state.closed = true;
        return;
      }
      state.text += decoder.decode(value, { stream: true });
    }
  })();
  return state;
}

// Runs a stream out past its deadline so no timer outlives its test.
const STREAM_END = 90_000;

const frame = (id: number, name: string) => `id: ${id}\nevent: ${name}\ndata: {}\n\n`;

// --- Tests ---

describe("GET /api/bookings/[token]/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a JSON 404 for an unknown token, before any stream", async () => {
    queueReads({ data: null, error: null });

    const res = await callGet();

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).not.toContain("text/event-stream");
    expect(await res.json()).toEqual({ error: "Booking not found" });
  });

  it("returns 404 for a malformed token without touching the database", async () => {
    const res = await callGet("abc");

    expect(res.status).toBe(404);
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it("returns a JSON 500 when the lookup fails", async () => {
    queueReads({ data: null, error: { message: "db down" } });

    const res = await callGet();

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).not.toContain("text/event-stream");
  });

  it("sets the SSE headers and no Connection header", async () => {
    queueReads(row(pending));

    const res = await callGet();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Connection")).toBeNull();
    await res.body!.cancel();
  });

  it("writes each step once as the row changes across polls, then done, then closes", async () => {
    queueReads(row(pending), row(confirmed), row(guestSent), row(allSet));

    const body = collect(await callGet());
    await vi.advanceTimersByTimeAsync(0);
    expect(body.text).toBe("");

    await vi.advanceTimersByTimeAsync(3_000);

    expect(body.text).toBe(
      frame(1, "payment_received") +
        frame(2, "confirmed") +
        frame(3, "guest_email_sent") +
        frame(4, "owner_email_sent") +
        frame(5, "done"),
    );
    expect(body.closed).toBe(true);

    const reads = mockSupabaseFrom.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSupabaseFrom.mock.calls.length).toBe(reads);
  });

  it("writes nothing on a poll where the row did not change", async () => {
    queueReads(row(confirmed), row(confirmed), row(confirmed));

    const body = collect(await callGet());
    await vi.advanceTimersByTimeAsync(0);
    const afterInitial = body.text;
    expect(afterInitial).toBe(frame(1, "payment_received") + frame(2, "confirmed"));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(body.text).toBe(afterInitial);
    expect(mockSupabaseFrom.mock.calls.length).toBe(3);
    await vi.advanceTimersByTimeAsync(STREAM_END);
  });

  it("honours Last-Event-ID and sends only the events above it", async () => {
    queueReads(row(allSet));

    const body = collect(await callGet(TOKEN, { headers: { "Last-Event-ID": "2" } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(body.text).toBe(
      frame(3, "guest_email_sent") + frame(4, "owner_email_sent") + frame(5, "done"),
    );
    expect(body.closed).toBe(true);
  });

  it("treats an invalid Last-Event-ID as 0", async () => {
    queueReads(row(allSet));

    const body = collect(await callGet(TOKEN, { headers: { "Last-Event-ID": "banana" } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(body.text.startsWith(frame(1, "payment_received"))).toBe(true);
  });

  it("stops polling after the client aborts", async () => {
    queueReads(row(confirmed));
    const controller = new AbortController();

    const body = collect(await callGet(TOKEN, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    expect(body.text).toContain("event: payment_received");

    controller.abort();
    const readsAtAbort = mockSupabaseFrom.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockSupabaseFrom.mock.calls.length).toBe(readsAtAbort);
  });

  it("ends with a timeout frame at 90 s and polls no more", async () => {
    queueReads(row(confirmed));

    const body = collect(await callGet());
    await vi.advanceTimersByTimeAsync(90_000);

    expect(body.text.endsWith("event: timeout\ndata: {}\n\n")).toBe(true);
    expect(body.closed).toBe(true);

    const reads = mockSupabaseFrom.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSupabaseFrom.mock.calls.length).toBe(reads);
  });

  it("pings every 15 s while nothing changes", async () => {
    queueReads(row(confirmed));

    const body = collect(await callGet());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(body.text).toContain(": ping\n\n");
    await vi.advanceTimersByTimeAsync(STREAM_END);
  });

  it("writes an error frame and closes when a poll fails", async () => {
    queueReads(row(confirmed), { data: null, error: { message: "db down" } });

    const body = collect(await callGet());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(
      body.text.endsWith('event: error\ndata: {"message":"Could not read booking status"}\n\n'),
    ).toBe(true);
    expect(body.closed).toBe(true);

    const reads = mockSupabaseFrom.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockSupabaseFrom.mock.calls.length).toBe(reads);
  });
});
