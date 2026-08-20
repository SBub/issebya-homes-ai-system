// Next.js instrumentation hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) —
// register() runs once, before any other app code, in every server runtime
// Next.js boots. Lives in src/ (not the project root), matching this app's
// existing src/app, src/lib placement convention.
//
// Axiom-only for tracing, unlike guest-communication-agent's instrumentation.ts
// (which also wires a Braintrust processor for AI-call observability) — this
// app makes no gen_ai calls, so there's nothing for Braintrust to show. Same
// OTel wiring otherwise: a BasicTracerProvider with Axiom's OTLP exporter as
// its SpanProcessor, filtered to drop Next.js's own framework-internal spans.
//
// A SECOND, independent thing lives here too: Sentry (error tracking, see the
// "Sentry" block in register() below) — deliberately NOT a SpanProcessor in
// the array above. Same coexistence hazard and fix as GCA's
// instrumentation.ts: @sentry/nextjs's Sentry.init() bootstraps its own
// OpenTelemetry TracerProvider/ContextManager/Propagator by default, which
// would silently call trace.setGlobalTracerProvider() a second time and
// clobber the BasicTracerProvider constructed below — breaking Axiom export
// entirely. This file passes `skipOpenTelemetrySetup: true` to Sentry.init()
// specifically to prevent that (see the Sentry block for the full citation
// trail through the installed package's source — identical to GCA's, this
// app resolves the same @sentry/nextjs version via the workspace's hoisted
// node_modules). This file remains the only code that ever calls
// trace.setGlobalTracerProvider().

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

  // Sentry — error tracking only, deliberately NOT a SpanProcessor entry in
  // `processors` above. Best-effort like Axiom: unset SENTRY_DSN just skips
  // it. On top of that, gated to production only regardless of SENTRY_DSN —
  // see the NODE_ENV check further down for why.
  //
  // The one thing that matters here: @sentry/node's `init()` (which
  // @sentry/nextjs's `init()` delegates straight to — see
  // node_modules/@sentry/nextjs/build/esm/server/index.js's `init()`, calling
  // `init$1(opts)` from '@sentry/node') calls `initOpenTelemetry(client, ...)`
  // by default, which does its own `trace.setGlobalTracerProvider(...)`,
  // `context.setGlobalContextManager(...)`, and
  // `propagation.setGlobalPropagator(...)` — see
  // node_modules/@sentry/node/build/esm/sdk/index.js:
  //   if (client && !options.skipOpenTelemetrySetup) { initOpenTelemetry(client, ...) }
  // Calling Sentry.init() naively would therefore silently replace this
  // file's BasicTracerProvider/AsyncHooksContextManager with Sentry's own
  // minimal SentryTracerProvider (see @sentry/opentelemetry's README, "Sentry
  // Tracer Provider" section) the instant it runs — breaking Axiom export
  // entirely, since nothing would ever reach the `processors` array above
  // again.
  //
  // `skipOpenTelemetrySetup: true` is the documented way to prevent this —
  // see node_modules/@sentry/node/node_modules/@sentry/node-core/build/types/types.d.ts,
  // `OpenTelemetryServerRuntimeOptions.skipOpenTelemetrySetup`: "If this is
  // set to true, the SDK will not set up OpenTelemetry automatically." With
  // it set, Sentry.init() only ever creates a Sentry client — it never
  // touches trace.setGlobalTracerProvider/context.setGlobalContextManager/
  // propagation.setGlobalPropagator, so this file's own calls to those
  // (above) remain the only ones that ever run. Sentry.captureException/
  // captureMessage work fully off this client alone — they don't depend on
  // OpenTelemetry at all.
  //
  // Uses its OWN Sentry project/DSN, separate from GCA's — same one-project-
  // per-app convention as the AXIOM_DATASET split above (one Axiom dataset
  // per app, one Sentry project per app), so errors from different apps
  // don't mix in one Sentry project.
  //
  // Sentry only ever runs in production — unlike Axiom above (which fails
  // loud if misconfigured *in* production, but still runs in dev/test when
  // configured), Sentry's policy is the opposite: never run outside
  // production at all, even if SENTRY_DSN happens to be set locally. Same
  // policy as GCA's instrumentation.ts (see that file's comment for the
  // incident that motivated this). No console.warn for the dev/test branch:
  // "Sentry doesn't run outside production" is the permanent intended
  // behavior, not a degraded/misconfigured state worth flagging (unlike an
  // unset AXIOM_TOKEN in dev, which usually is accidental).
  const sentryDsn = process.env.SENTRY_DSN;
  if (process.env.NODE_ENV === "production" && sentryDsn) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: sentryDsn,
      skipOpenTelemetrySetup: true,
      // Explicit, not Sentry's own env-var-sniffing default — same
      // "explicit over implicit framework defaults" preference this
      // codebase applies elsewhere (e.g. ATTR_SERVICE_NAME below instead of
      // relying on OTel's own service-name resolution).
      environment: "production",
    });
  } else if (process.env.NODE_ENV === "production") {
    console.warn("[instrumentation] Sentry error tracking disabled — SENTRY_DSN not set");
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
