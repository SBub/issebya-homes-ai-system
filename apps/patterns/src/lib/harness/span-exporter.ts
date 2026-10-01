/**
 * An in-memory tracer and batch exporter for the agent harness demos. It
 * keeps the rules of OpenTelemetry that the docs depend on, and nothing
 * else:
 *
 * - A span has a trace id and a span id, random hex of the real lengths, and
 *   a parent span id or none. A child opened under an anchor shares its
 *   trace id.
 * - With no exporter (no tracer provider registered, in OTel terms) every
 *   span carries the all-zero ids. That sentinel means "no trace", not an
 *   identifier.
 * - `withSpan` sets an ambient active span for the duration of its callback,
 *   as `startActiveSpan` does. A span opened without an explicit parent
 *   nests under the active one, or starts a root when there is none.
 * - An ended span is queued, not exported. Nothing leaves the queue until
 *   `flush()`. `freeze()` is what a serverless platform does to the process
 *   after the response: the queue is dropped.
 */

export type TraceAnchor = { traceId: string; spanId: string };

export const INVALID_TRACE_ID = "0".repeat(32);
const INVALID_SPAN_ID = "0".repeat(16);
export const INVALID_ANCHOR: TraceAnchor = { traceId: INVALID_TRACE_ID, spanId: INVALID_SPAN_ID };

const HEX = /^[0-9a-f]+$/;

export function isValidTraceId(id: string): boolean {
  return id.length === 32 && HEX.test(id) && id !== INVALID_TRACE_ID;
}

export function isValidSpanId(id: string): boolean {
  return id.length === 16 && HEX.test(id) && id !== INVALID_SPAN_ID;
}

export function isValidTraceAnchor(anchor: TraceAnchor): boolean {
  return isValidTraceId(anchor.traceId) && isValidSpanId(anchor.spanId);
}

type AttributeValue = string | number | boolean;

export type EndedSpan = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  attributes: Record<string, AttributeValue>;
  status: "unset" | "error";
  error: string | null;
  /** Position in end order, so a tree can be rendered in a stable order. */
  order: number;
};

export type Span = {
  readonly anchor: TraceAnchor;
  setAttribute(key: string, value: AttributeValue): void;
  /** Marks the span as failed without throwing. */
  fail(message: string): void;
  end(): void;
};

type ExporterSnapshot = {
  /** Ended, queued, not yet sent. */
  pending: EndedSpan[];
  /** Reached the backend. */
  exported: EndedSpan[];
  /** Lost to a freeze before a flush. */
  dropped: EndedSpan[];
  flushes: number;
};

export type BatchExporter = {
  enqueue(span: EndedSpan): void;
  /** Sends every pending span, after `delay` ms, as one batch. */
  flush(): Promise<void>;
  /** The process is frozen: the queue is dropped, a pending timer never fires. */
  freeze(): void;
  clear(): void;
  getSnapshot(): ExporterSnapshot;
  subscribe(listener: () => void): () => void;
};

const EMPTY = (): ExporterSnapshot => ({ pending: [], exported: [], dropped: [], flushes: 0 });

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `delay` is how long one export round trip takes, so a demo can show what
 * flushing before the response costs the response.
 */
export function createBatchExporter(options: { delay?: number } = {}): BatchExporter {
  const delay = options.delay ?? 0;
  const listeners = new Set<() => void>();
  let snapshot = EMPTY();

  function emit(next: ExporterSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  return {
    enqueue(span) {
      emit({ ...snapshot, pending: [...snapshot.pending, span] });
    },
    async flush() {
      const batch = snapshot.pending;
      if (batch.length === 0) return;
      // The batch leaves the queue when the flush starts, as a real exporter takes it.
      emit({ ...snapshot, pending: [] });
      if (delay > 0) await wait(delay);
      emit({
        ...snapshot,
        exported: [...snapshot.exported, ...batch],
        flushes: snapshot.flushes + 1,
      });
    },
    freeze() {
      if (snapshot.pending.length === 0) return;
      emit({ ...snapshot, pending: [], dropped: [...snapshot.dropped, ...snapshot.pending] });
    },
    clear() {
      emit(EMPTY());
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type SpanOptions = {
  /** An anchor to nest under. `null` forces a root. Omitted: the ambient active span, or a root. */
  parent?: TraceAnchor | null;
  attributes?: Record<string, AttributeValue>;
};

export type Tracer = {
  startSpan(name: string, options?: SpanOptions): Span;
  /** Runs `fn` inside a span that is active for its duration, ends the span, and marks it failed on a throw. */
  withSpan<T>(name: string, options: SpanOptions, fn: (span: Span) => T | Promise<T>): Promise<T>;
  /** A root span, never parented, whose anchor the caller threads downstream as data. */
  startRoot<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
  ): Promise<{ anchor: TraceAnchor; result: T }>;
  /** The ambient active span's anchor, inside a `withSpan` callback; null outside one. */
  activeAnchor(): TraceAnchor | null;
};

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * `exporter` null is a process with no tracer provider registered: every
 * span carries the all-zero ids and nothing is ever exported.
 */
export function createTracer(exporter: BatchExporter | null): Tracer {
  const active: TraceAnchor[] = [];
  let order = 0;

  function startSpan(name: string, options: SpanOptions = {}): Span {
    const ambient = active.at(-1) ?? null;
    const parent = options.parent === undefined ? ambient : options.parent;
    const recording = exporter !== null;
    const anchor: TraceAnchor = recording
      ? { traceId: parent?.traceId ?? randomHex(16), spanId: randomHex(8) }
      : INVALID_ANCHOR;
    const attributes: Record<string, AttributeValue> = { ...options.attributes };
    let status: EndedSpan["status"] = "unset";
    let error: string | null = null;
    let ended = false;

    return {
      anchor,
      setAttribute(key, value) {
        attributes[key] = value;
      },
      fail(message) {
        status = "error";
        error = message;
      },
      end() {
        if (ended || exporter === null) return;
        ended = true;
        order += 1;
        exporter.enqueue({
          name,
          traceId: anchor.traceId,
          spanId: anchor.spanId,
          parentSpanId: parent?.spanId ?? null,
          attributes,
          status,
          error,
          order,
        });
      },
    };
  }

  async function withSpan<T>(
    name: string,
    options: SpanOptions,
    fn: (span: Span) => T | Promise<T>,
  ): Promise<T> {
    const span = startSpan(name, options);
    active.push(span.anchor);
    try {
      return await fn(span);
    } catch (thrown) {
      span.fail(thrown instanceof Error ? thrown.message : String(thrown));
      throw thrown;
    } finally {
      active.pop();
      span.end();
    }
  }

  return {
    startSpan,
    withSpan,
    async startRoot(name, fn) {
      let anchor = INVALID_ANCHOR;
      const result = await withSpan(name, { parent: null }, (span) => {
        anchor = span.anchor;
        return fn(span);
      });
      return { anchor, result };
    },
    activeAnchor: () => active.at(-1) ?? null,
  };
}

export type SpanNode = { span: EndedSpan; children: SpanNode[] };

/**
 * Nests spans by parent id. A span whose parent is not in the list is a
 * root, which is how a disconnected trace shows up: as a second root.
 */
export function buildSpanTree(spans: EndedSpan[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  const sorted = [...spans].sort((a, b) => a.order - b.order);
  for (const span of sorted) nodes.set(span.spanId, { span, children: [] });

  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.span.parentSpanId === null ? null : nodes.get(node.span.parentSpanId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
