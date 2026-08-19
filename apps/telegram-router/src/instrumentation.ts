// Next.js instrumentation hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) —
// register() runs once, before any other app code, in every server runtime
// Next.js boots. Lives in src/ (not the project root), matching this app's
// existing src/app, src/lib placement convention.
//
// Axiom-only, unlike guest-communication-agent's instrumentation.ts (which
// also wires a Braintrust processor for AI-call observability) — this app
// makes no gen_ai calls, so there's nothing for Braintrust to show. Same
// OTel wiring otherwise: a BasicTracerProvider with Axiom's OTLP exporter as
// its SpanProcessor, filtered to drop Next.js's own framework-internal spans.

import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

// Same denylist as guest-communication-agent's instrumentation.ts — pure
// dev-server/render-pipeline noise, plus per-route request-lifecycle spans
// that duplicate the real root span (webhook.telegram_update,
// owner_nudges.send) this app's own routes already open as their first stage.
const NEXT_INTERNAL_SPAN_NAMES = new Set([
  "resolve page components",
  "resolve segment modules",
  "build component tree",
  "start response",
  "NextNodeServer.clientComponentLoading",
]);

const NEXT_ROUTE_SPAN_PATTERN =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/|^executing api route /;

class FilteringSpanProcessor implements SpanProcessor {
  constructor(
    private readonly inner: SpanProcessor,
    private readonly isNoise: (name: string) => boolean,
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (!this.isNoise(span.name)) {
      this.inner.onEnd(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

let registered = false;

export async function register(): Promise<void> {
  // Edge runtime doesn't support Node's `crypto`/OTel's Node exporters —
  // this app's tracing is server (nodejs) runtime only.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (registered) {
    return;
  }
  registered = true;

  const { BasicTracerProvider, BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } =
    await import("@opentelemetry/sdk-trace-base");
  const { context, trace } = await import("@opentelemetry/api");
  const { AsyncHooksContextManager } = await import("@opentelemetry/context-async-hooks");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

  // Same reasoning as GCA's instrumentation.ts: without a real ContextManager,
  // context.with()/context.active() (used by tracing.ts's withSpan to nest
  // child spans) silently no-op, fragmenting every request into unrelated
  // root traces instead of one nested trace per request.
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  const processors: SpanProcessor[] = [];

  const axiomToken = process.env.AXIOM_TOKEN;
  const axiomDataset = process.env.AXIOM_DATASET;
  if (axiomToken && axiomDataset) {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    processors.push(
      new FilteringSpanProcessor(
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `https://${process.env.AXIOM_DOMAIN ?? "api.axiom.co"}/v1/traces`,
            headers: {
              Authorization: `Bearer ${axiomToken}`,
              "X-Axiom-Dataset": axiomDataset,
            },
          }),
        ),
        (name) => NEXT_INTERNAL_SPAN_NAMES.has(name) || NEXT_ROUTE_SPAN_PATTERN.test(name),
      ),
    );
  } else if (process.env.NODE_ENV === "production") {
    // Same reasoning as GCA's instrumentation.ts: booting with zero
    // observability in production should fail loud, not warn-and-continue.
    throw new Error(
      "[instrumentation] Axiom tracing is required in production but AXIOM_TOKEN/AXIOM_DATASET are not set",
    );
  } else {
    console.warn("[instrumentation] Axiom tracing disabled — AXIOM_TOKEN/AXIOM_DATASET not set");
  }

  // Dev-only, no-signup-required option: prints every span to stdout as it
  // ends. Same NEVER-in-production caveat as GCA's instrumentation.ts —
  // spans here carry guest phone numbers (gca.phone-equivalent attributes)
  // and reply text.
  if (process.env.DEBUG_TRACING === "1") {
    processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  if (processors.length === 0) {
    console.warn("[instrumentation] No tracing backend configured — no SpanProcessor registered");
    return;
  }

  // Same v2 BasicTracerProvider constructor-only spanProcessors API as GCA's
  // instrumentation.ts — see that file's comment for why (no addSpanProcessor()
  // in @opentelemetry/sdk-trace-base v2.x).
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "telegram-router",
    }),
    spanProcessors: processors,
  });

  trace.setGlobalTracerProvider(provider);

  // Heartbeat span for the Axiom dead-man's-switch monitor — same reasoning
  // as GCA's instrumentation.ts: this app's real traffic is low and sporadic,
  // so "zero events in N minutes" would false-alarm on an otherwise-healthy
  // system; see that file's comment for the full why. Only runs when the
  // Axiom processor above was actually configured.
  if (axiomToken && axiomDataset) {
    const heartbeatTracer = trace.getTracer("instrumentation-heartbeat");
    const heartbeatInterval = setInterval(
      () => {
        heartbeatTracer.startSpan("instrumentation.heartbeat").end();
      },
      5 * 60 * 1000,
    );
    // Never let this timer keep the process alive on its own.
    heartbeatInterval.unref();
  }

  console.log(
    `[instrumentation] Tracing initialized (${processors.length} processor${processors.length > 1 ? "s" : ""})`,
  );
}
