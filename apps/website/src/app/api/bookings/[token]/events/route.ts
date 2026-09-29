import { captureException, startSpan } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  type BookingStepRow,
  DONE_EVENT_ID,
  formatSseFrame,
  nextEvents,
  SSE_PING,
} from "@/lib/bookings/steps";
import { createAdminClient } from "@/lib/shared/supabase";

// Polling rather than Supabase Realtime: the webhook usually finishes within
// seconds, so a short-lived stream reading one indexed row a second needs no
// new infrastructure. The deadline keeps each invocation well inside Vercel's
// function limit.
const POLL_INTERVAL_MS = 1_000;
const PING_INTERVAL_MS = 15_000;
const STREAM_DEADLINE_MS = 90_000;

// Shape of `encode(gen_random_bytes(32), 'hex')`, the bookings.access_token default.
const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const lastEventIdSchema = z.coerce.number().int().min(0).max(DONE_EVENT_ID);

// Never the booking UUID, the Stripe session id or the email.
const STEP_COLUMNS = "status, confirmed_at, guest_email_sent_at, owner_email_sent_at";

const encoder = new TextEncoder();

function readSteps(token: string) {
  return createAdminClient()
    .from("bookings")
    .select(STEP_COLUMNS)
    .eq("access_token", token)
    .in("status", ["pending", "confirmed"])
    .maybeSingle<BookingStepRow>();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await params;

  const token = tokenSchema.safeParse(rawToken);
  if (!token.success) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const lookup = await startSpan(
    {
      name: "api.bookings.events",
      op: "http.server",
      attributes: { "http.route": "/api/bookings/[token]/events" },
    },
    async (span) => {
      const { data, error } = await readSteps(token.data);
      if (error) {
        span?.setStatus({ code: 2, message: "Database error" });
        captureException(error, { tags: { "booking.events": "lookup" } });
      }
      return { row: data, error };
    },
  );

  if (lookup.error) {
    return NextResponse.json({ error: "Could not read booking status" }, { status: 500 });
  }
  if (!lookup.row) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const initialRow = lookup.row;
  const parsedLastId = lastEventIdSchema.safeParse(request.headers.get("last-event-id") ?? 0);
  let lastId = parsedLastId.success ? parsedLastId.data : 0;

  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(pollTimer);
        clearInterval(pingTimer);
        clearTimeout(deadlineTimer);
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed or errored by the runtime after a disconnect.
        }
      };

      // Writes what the client has not seen; true once `done` went out.
      const writeNew = (row: BookingStepRow) => {
        for (const event of nextEvents(row, lastId)) {
          write(formatSseFrame({ id: event.id, event: event.name, data: {} }));
          lastId = event.id;
        }
        return lastId === DONE_EVENT_ID;
      };

      // Self-rescheduling rather than setInterval, so a slow query can never
      // overlap the next one.
      const poll = async () => {
        if (closed) return;
        const { data, error } = await readSteps(token.data);
        if (closed) return;
        if (error || !data) {
          if (error) captureException(error, { tags: { "booking.events": "poll" } });
          write(
            formatSseFrame({ event: "error", data: { message: "Could not read booking status" } }),
          );
          cleanup();
          return;
        }
        if (writeNew(data)) {
          cleanup();
          return;
        }
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      };

      if (request.signal.aborted) {
        cleanup();
        return;
      }
      request.signal.addEventListener("abort", cleanup);

      if (writeNew(initialRow)) {
        cleanup();
        return;
      }

      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      pingTimer = setInterval(() => write(SSE_PING), PING_INTERVAL_MS);
      deadlineTimer = setTimeout(() => {
        write(formatSseFrame({ event: "timeout", data: {} }));
        cleanup();
      }, STREAM_DEADLINE_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
