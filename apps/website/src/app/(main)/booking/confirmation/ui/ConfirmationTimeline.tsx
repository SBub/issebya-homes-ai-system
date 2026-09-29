"use client";

import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";
import {
  BOOKING_STEPS,
  type BookingStepName,
  type BookingStepRow,
  computeEvents,
  isDone,
} from "@/lib/bookings/steps";

export const STEP_LABELS: Record<BookingStepName, string> = {
  payment_received: "Payment received",
  confirmed: "Booking confirmed",
  // Completed with " to <email>" when the email is known.
  guest_email_sent: "Confirmation sent",
  owner_email_sent: "We have been notified",
};

export const TIMEOUT_COPY =
  "This is taking longer than usual. Your booking is safe; the email will follow.";

type SeenName = BookingStepName | "done";

type Props = {
  token: string | null;
  email: string | null;
  initial: BookingStepRow;
};

/**
 * The booking's post-payment steps. Renders the steps already true on the
 * server, so they are in the HTML without JavaScript, then appends the rest
 * as /api/bookings/[token]/events reports them. No stream is opened for a
 * booking that is already done or has no token.
 */
export function ConfirmationTimeline({ token, email, initial }: Props) {
  const [seen, setSeen] = useState<ReadonlySet<SeenName>>(
    () => new Set(computeEvents(initial).map((event) => event.name)),
  );
  const seenRef = useRef(seen);
  const [timedOut, setTimedOut] = useState(false);

  const shouldStream = token !== null && !isDone(initial);

  // Subscribes to an external system (the SSE stream), which is what an
  // effect is for.
  useEffect(() => {
    if (!shouldStream) return;

    const openedAt = Date.now();
    let reported = false;
    const source = new EventSource(`/api/bookings/${token}/events`);

    // Idempotent: on a fresh connection the server re-sends the steps the
    // page was seeded with.
    const mark = (name: SeenName) => {
      if (seenRef.current.has(name)) return;
      const next = new Set(seenRef.current).add(name);
      seenRef.current = next;
      setSeen(next);
    };

    for (const name of BOOKING_STEPS) {
      source.addEventListener(name, () => mark(name));
    }

    source.addEventListener("done", () => {
      mark("done");
      if (!reported) {
        reported = true;
        posthog.capture("booking_confirmation_stream_completed", {
          steps: BOOKING_STEPS.filter((name) => seenRef.current.has(name)).length,
          seconds: Math.round((Date.now() - openedAt) / 1000),
        });
      }
      source.close();
    });

    source.addEventListener("timeout", () => {
      setTimedOut(true);
      source.close();
    });

    // The server's own `event: error` arrives as a MessageEvent and is final.
    // A plain connection error is left to the browser's auto-reconnect, which
    // resumes from Last-Event-ID.
    source.addEventListener("error", (event) => {
      if (event instanceof MessageEvent) source.close();
    });

    return () => source.close();
  }, [token, shouldStream]);

  return (
    <div>
      <ol aria-live="polite" data-testid="confirmation-timeline" className="space-y-1">
        {BOOKING_STEPS.filter((name) => seen.has(name)).map((name) => (
          <li key={name}>
            {name === "guest_email_sent" && email
              ? `${STEP_LABELS[name]} to ${email}`
              : STEP_LABELS[name]}
          </li>
        ))}
      </ol>
      {timedOut && <p className="pt-2">{TIMEOUT_COPY}</p>}
    </div>
  );
}
