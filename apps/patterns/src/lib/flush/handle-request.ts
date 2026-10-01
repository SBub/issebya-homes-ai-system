import type { BatchExporter, Tracer } from "@/lib/harness/span-exporter";

/**
 * The request behind the `flush-before-freeze` demo, on the harness tracer
 * and batch exporter, under a model of a serverless platform: the handler
 * runs, the response goes out, the callbacks registered with `after` run,
 * and then the process is frozen. Spans end during the handler and sit in
 * the exporter's queue; only a flush sends them, and only a flush before the
 * freeze counts.
 *
 * - `"after"` is the pattern: the response goes out at once and the flush
 *   runs in the kept-alive window after it.
 * - `"none"` never flushes, so the freeze drops the queue.
 * - `"before-response"` awaits the flush in the handler, so the spans
 *   export but the response waits for the exporter's round trip.
 */

export type FlushMode = "none" | "after" | "before-response";

export type RequestOutcome = {
  status: number;
  /** Milliseconds from the start of the handler to the response. */
  responseMs: number;
  exported: number;
  dropped: number;
};

type Platform = {
  /** Registers work to run once the response is sent, before the freeze. */
  after: (fn: () => Promise<void>) => void;
};

/** One request on the platform model: handler, response, after callbacks, freeze. */
export async function handleRequest(options: {
  tracer: Tracer;
  exporter: BatchExporter;
  flush: FlushMode;
  now?: () => number;
}): Promise<RequestOutcome> {
  const { tracer, exporter, flush, now = () => performance.now() } = options;
  const callbacks: Array<() => Promise<void>> = [];
  const platform: Platform = { after: (fn) => callbacks.push(fn) };
  const started = now();

  const status = await handler(tracer, exporter, flush, platform);
  const responseMs = Math.round(now() - started);

  for (const callback of callbacks) await callback();
  exporter.freeze();

  const snapshot = exporter.getSnapshot();
  return {
    status,
    responseMs,
    exported: snapshot.exported.length,
    dropped: snapshot.dropped.length,
  };
}

async function handler(
  tracer: Tracer,
  exporter: BatchExporter,
  flush: FlushMode,
  platform: Platform,
): Promise<number> {
  await tracer.withSpan("handle-request", { parent: null }, async () => {
    await tracer.withSpan("load-item", {}, (span) => {
      span.setAttribute("item.id", 1);
    });
    await tracer.withSpan("render", {}, () => undefined);
  });

  if (flush === "before-response") await exporter.flush();
  if (flush === "after") platform.after(() => exporter.flush());
  return 200;
}
