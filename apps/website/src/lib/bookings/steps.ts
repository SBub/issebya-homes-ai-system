// The post-payment steps of a booking, derived from its row. Shared by the
// SSE route (/api/bookings/[token]/events) and the confirmation page's client
// island (ConfirmationTimeline), so it must import nothing server-only.

export type BookingStepRow = {
  status: string;
  confirmed_at: string | null;
  guest_email_sent_at: string | null;
  owner_email_sent_at: string | null;
};

// Order is the event id: a step's id is its 1-based index here, and `done`
// comes after the last step.
export const BOOKING_STEPS = [
  "payment_received",
  "confirmed",
  "guest_email_sent",
  "owner_email_sent",
] as const;

export type BookingStepName = (typeof BOOKING_STEPS)[number];

export const DONE_EVENT_ID = BOOKING_STEPS.length + 1;

export type BookingEvent = { id: number; name: BookingStepName | "done" };

const STEP_IS_TRUE: Record<BookingStepName, (row: BookingStepRow) => boolean> = {
  // The `direct` route's synchronous Stripe check writes `status =
  // "confirmed"`, so "Stripe says paid" is observed through the row.
  payment_received: (row) => row.status === "confirmed" || row.confirmed_at !== null,
  confirmed: (row) => row.confirmed_at !== null,
  guest_email_sent: (row) => row.guest_email_sent_at !== null,
  owner_email_sent: (row) => row.owner_email_sent_at !== null,
};

/**
 * Every event already true for `row`, in id order. An ordered subset, not a
 * prefix: a failed guest email leaves id 3 out while id 4 can still appear.
 * `done` only follows when all four steps are present.
 */
export function computeEvents(row: BookingStepRow): BookingEvent[] {
  const events: BookingEvent[] = BOOKING_STEPS.flatMap((name, index) =>
    STEP_IS_TRUE[name](row) ? [{ id: index + 1, name }] : [],
  );
  if (events.length === BOOKING_STEPS.length) {
    events.push({ id: DONE_EVENT_ID, name: "done" });
  }
  return events;
}

/** The events the client has not seen yet, given its `Last-Event-ID`. */
export function nextEvents(row: BookingStepRow, lastId: number): BookingEvent[] {
  return computeEvents(row).filter((event) => event.id > lastId);
}

export function isDone(row: BookingStepRow): boolean {
  return BOOKING_STEPS.every((name) => STEP_IS_TRUE[name](row));
}

/** One Server-Sent Events frame. Frames without `id` never move `Last-Event-ID`. */
export function formatSseFrame({
  id,
  event,
  data,
}: {
  id?: number;
  event: string;
  data: unknown;
}): string {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** An SSE comment line, which keeps idle proxies from closing the connection. */
export const SSE_PING = ": ping\n\n";
