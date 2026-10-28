import { formatComment, formatEvent } from "./frame";

/**
 * The producer behind the `sse-route-handler` demo: five progress events, a
 * `: ping` comment between them and a closing `done` event.
 *
 * In real use the heartbeat is a ping every 15 s while the server waits on
 * work. The demo pings between steps instead, because its whole run is 2.5 s.
 *
 * Lives outside `route.ts` because Next allows only HTTP-method and segment
 * config exports from a route file, and the tests need these.
 */

const PROGRESS_STEPS = [
  { id: 1, percent: 10, step: "Request received" },
  { id: 2, percent: 30, step: "Checking dates" },
  { id: 3, percent: 70, step: "Holding the room" },
  { id: 4, percent: 90, step: "Taking payment" },
  { id: 5, percent: 100, step: "Confirmed" },
] as const;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // `no-transform` stops compressing proxies from buffering the stream to
  // compress it, which would hold every event until the response ends.
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Turns off nginx-style response buffering in front of the function.
  "X-Accel-Buffering": "no",
};

/** The id to resume after: a non-negative integer, or 0 for anything else. */
export function parseResumeId(value: string | null): number {
  if (value === null || !/^\d+$/.test(value.trim())) return 0;
  return Number(value.trim());
}

export function createProgressStream({
  fromId,
  delayMs,
  signal,
}: {
  fromId: number;
  delayMs: number;
  signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const steps = PROGRESS_STEPS.filter(({ id }) => id > fromId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        stop();
        if (closed) return;
        closed = true;
        controller.close();
      };

      if (signal.aborted) {
        close();
        return;
      }
      // The client left: stop the timer so nothing runs for nobody.
      signal.addEventListener("abort", close, { once: true });

      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      const emit = (index: number) => {
        if (index === steps.length) {
          send(formatEvent({ event: "done", data: { lastId: PROGRESS_STEPS.length } }));
          signal.removeEventListener("abort", close);
          close();
          return;
        }
        if (index > 0) send(formatComment("ping"));
        timer = setTimeout(() => {
          const { id, percent, step } = steps[index];
          send(formatEvent({ id, event: "progress", data: { percent, step } }));
          emit(index + 1);
        }, delayMs);
      };

      emit(0);
    },
    // A reader cancelling is the other way a client leaves.
    cancel() {
      closed = true;
      stop();
    },
  });
}
