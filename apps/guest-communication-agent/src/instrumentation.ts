// Next.js instrumentation hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) —
// register() runs once, before any other app code, in every server runtime
// Next.js boots. Lives in src/ (not the project root) because this app puts
// all its own code under src/ (see src/agent, src/lib, src/app) — same
// placement convention Next.js uses for src/middleware.ts.
//
// Wires OpenTelemetry tracing for TWO independent backends, as separate
// SpanProcessors on one shared BasicTracerProvider/span stream:
//
//   - Braintrust (AI-call observability): every guest turn's full reasoning
//     chain (system-prompt call, tool calls, the conversation summarizer
//     call) lands in Braintrust as one trace, filtered to gen_ai.*/llm.*/
//     ai.*/braintrust.*/traceloop.*-prefixed spans only. See
//     src/lib/tracing.ts's withTurnSpan for the deterministic trace/span id
//     scheme that makes this safe under Inngest's replay model.
//   - Axiom (general app-health observability): unfiltered — every span,
//     including the same AI spans Braintrust gets (same provider, same span
//     objects, just a second sink) plus everything Braintrust drops: Next.js's
//     own HTTP-request/API-route/fetch spans (emitted automatically once any
//     tracer provider is registered — no extra auto-instrumentation package
//     needed), and this app's own webhook/DB/reply-delivery spans (see
//     src/lib/tracing.ts's withSpan, and the routes/lib files that call it).
//
// Both are independently optional/best-effort — unset env vars for either one
// just skips that processor, matching this app's existing convention (e.g.
// TELEGRAM_ROUTER_API_URL in .env.example) of degrading a feature rather than
// crashing. Deliberately built on vendor-neutral `@opentelemetry/api` with
// each vendor's/exporter's SpanProcessor plugged into a standard OTel
// BasicTracerProvider — NOT any vendor's proprietary logging API — so adding
// a third processor later is just another entry in the array below, zero
// changes to any instrumentation call site in application code.
//
// A THIRD, independent thing lives here too: Sentry (error tracking, see the
// "Sentry" block in register() below) — deliberately NOT a SpanProcessor in
// the array above. @sentry/nextjs's Sentry.init() bootstraps its own
// OpenTelemetry TracerProvider/ContextManager/Propagator by default, which
// would silently call trace.setGlobalTracerProvider() a second time and
// clobber the BasicTracerProvider constructed below — breaking Axiom/
// Braintrust export entirely. This file passes `skipOpenTelemetrySetup: true`
// to Sentry.init() specifically to prevent that (see the Sentry block for the
// full citation trail through the installed package's source). This file
// remains the only code that ever calls trace.setGlobalTracerProvider().

import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

// Framework-internal spans Next.js's own auto-instrumentation emits the
// moment any tracer provider is registered (see this file's header comment)
// — pure dev-server/render-pipeline noise with zero bearing on a guest
// turn's health (e.g. "resolve page components" is a Turbopack/webpack
// module-resolution step, not anything this app's code did). Denylist, not
// allowlist: this app's own span names are a small, explicit set (webhook.*,
// gen_ai.*, db.*, etc.) that would be tedious and fragile to enumerate
// positively, whereas Next.js's internal names are few, stable, and easy to
// name directly.
const NEXT_INTERNAL_SPAN_NAMES = new Set([
  "resolve page components",
  "resolve segment modules",
  "build component tree",
  "start response",
  "NextNodeServer.clientComponentLoading",
]);

// Next's per-route request-lifecycle spans — "POST /api/webhook/whatsapp",
// "executing api route (app) /api/webhook/whatsapp", one pair per HTTP
// method/route combination across the whole app, not just this one route —
// hence a pattern instead of NEXT_INTERNAL_SPAN_NAMES' exact-name Set.
// Redundant everywhere in this app specifically: every route that does
// anything worth tracing already opens its own real root span (startTraceRoot)
// as its first stage (e.g. webhook.turn, owner_nudges.handle_reply), so these
// just duplicate "a request came in" one level higher for no extra signal.
const NEXT_ROUTE_SPAN_PATTERN =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/|^executing api route /;

// Wraps another SpanProcessor, dropping spans by exact name before they
// reach it — same idea as @braintrust/otel's own filterAISpans option
// (instrumentation.ts's Braintrust processor below), just applied to
// Axiom's export instead, since Axiom is deliberately unfiltered otherwise
// (see this file's header comment) and these span names would never match
// Braintrust's own gen_ai./llm./ai./braintrust./traceloop. filter anyway.
// onStart still forwards through unfiltered — only onEnd is where a span
// actually gets exported, so context propagation for real children is
// unaffected either way.
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

// Guards against Next.js dev-mode hot-reload calling register() more than
// once — a second SpanProcessor on the same provider would double-export
// every span.
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

  // Registers a real ContextManager so context.with(...)/context.active()
  // (used by src/lib/tracing.ts's withTurnSpan/withSpan to make a span
  // "active" before starting a child span) actually propagate context across
  // the awaits inside Inngest step callbacks and Next.js route handlers,
  // instead of silently no-op'ing. Without this, @opentelemetry/api's default
  // no-op ContextManager makes context.with(ctx, fn) just call fn() directly
  // — context.active() always reads back as the root/empty context, so every
  // startActiveSpan call falls back to a fresh random trace id with no
  // parent, fragmenting what should be one trace into many. Unconditional —
  // NOT gated behind either vendor's own env-var check below — because
  // context propagation is needed for Next.js's own auto-instrumentation and
  // any processor, not just Braintrust. Gating this behind
  // BRAINTRUST_API_KEY would silently break span nesting for everything,
  // Axiom included, whenever Braintrust is unconfigured.
  // AsyncHooksContextManager (async_hooks/AsyncLocalStorage-backed) is the
  // Node-appropriate choice here — the browser-only alternative
  // (ZoneContextManager) doesn't apply to this server-only instrumentation.
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  const processors: SpanProcessor[] = [];

  const braintrustApiKey = process.env.BRAINTRUST_API_KEY;
  const braintrustProjectId = process.env.BRAINTRUST_PROJECT_ID;
  if (braintrustApiKey && braintrustProjectId) {
    const { BraintrustSpanProcessor, setupOtelCompat } = await import("@braintrust/otel");
    setupOtelCompat(); // enables interop with Braintrust's own logger/traced API if anything else ever uses it — cheap, call it
    processors.push(
      new BraintrustSpanProcessor({
        apiKey: braintrustApiKey,
        // issebya's Braintrust org is EU-data-plane — the US default 421s
        // with DataPlaneRedirectError, same gotcha already documented in
        // scripts/migrate-prompts-to-braintrust.ts and .env.example.
        apiUrl: "https://api-eu.braintrust.dev",
        parent: `project_id:${braintrustProjectId}`,
        // Keeps to gen_ai.*/llm.*/ai.*/braintrust.*/traceloop.*-prefixed
        // spans only — deliberate, keeps Braintrust's UI AI-call-focused even
        // though the Axiom processor below now sees everything.
        filterAISpans: true,
      }),
    );
  } else {
    console.warn(
      "[instrumentation] Braintrust tracing disabled — BRAINTRUST_API_KEY/BRAINTRUST_PROJECT_ID not set",
    );
  }

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
    // Silently booting with zero observability in production is worse than
    // not booting at all — fail loud instead of warn-and-continue. Dev/test
    // keep the warn-and-continue behavior below; only production is this
    // strict.
    throw new Error(
      "[instrumentation] Axiom tracing is required in production but AXIOM_TOKEN/AXIOM_DATASET are not set",
    );
  } else {
    console.warn("[instrumentation] Axiom tracing disabled — AXIOM_TOKEN/AXIOM_DATASET not set");
  }

  // Sentry — error tracking only, deliberately NOT a SpanProcessor entry in
  // `processors` above. Best-effort like Braintrust/Axiom: unset SENTRY_DSN
  // just skips it.
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
  // Tracer Provider" section) the instant it runs — breaking Axiom/Braintrust
  // export entirely, since nothing would ever reach the `processors` array
  // above again.
  //
  // `skipOpenTelemetrySetup: true` is the documented way to prevent this —
  // see node_modules/@sentry/node/node_modules/@sentry/node-core/build/types/types.d.ts,
  // `OpenTelemetryServerRuntimeOptions.skipOpenTelemetrySetup`: "If this is
  // set to true, the SDK will not set up OpenTelemetry automatically." With
  // it set, Sentry.init() only ever creates a Sentry client — it never
  // touches trace.setGlobalTracerProvider/context.setGlobalContextManager/
  // propagation.setGlobalPropagator, so this file's own calls to those
  // (below, and in the context-manager setup above) remain the only ones
  // that ever run. Sentry.captureException/captureMessage work fully off
  // this client alone — they don't depend on OpenTelemetry at all.
  //
  // Deliberately NOT wiring @sentry/opentelemetry's `SentrySpanProcessor`
  // into the `processors` array above either, even though that's the
  // documented way to additionally feed this app's spans into Sentry's APM
  // product (same pattern as the Braintrust/Axiom processors — see
  // @sentry/opentelemetry's README "Usage" section). Doing so would mean
  // *every* span this app creates — including full gen_ai.input.messages/
  // gen_ai.output.messages guest-conversation content on every AI span (see
  // the DEBUG_TRACING PII note above) — starts flowing into Sentry too,
  // uncapped by Sentry's tracesSampleRate (that option only gates spans
  // created *through Sentry's own start-span API*; spans created via the
  // plain @opentelemetry/api calls this app's withSpan/withTurnSpan use are
  // governed entirely by the provider's sampler, which this file leaves at
  // its OTel default and does not repurpose as Sentry's SentrySampler — doing
  // that would also apply Sentry's sampling decision to the Braintrust/Axiom
  // processors, since it's the same provider/sampler for all of them). This
  // block is scoped to error capture only, per this session's task. If/when
  // Sentry APM tracing is actually wanted, add
  // `new SentrySpanProcessor()` (from "@sentry/opentelemetry") to the
  // `processors` array above — no other change needed, `skipOpenTelemetrySetup`
  // is unaffected by that.
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: sentryDsn,
      skipOpenTelemetrySetup: true,
    });
  } else {
    console.warn("[instrumentation] Sentry error tracking disabled — SENTRY_DSN not set");
  }

  // Dev-only, no-signup-required option: prints every span to stdout as it
  // ends, via SimpleSpanProcessor (synchronous export — spans show up
  // immediately, not batched/delayed, which matters when you're watching the
  // terminal live). Independent of Braintrust/Axiom above — works whether or
  // not either is configured, additive. Never turn this on in production:
  // console-exporting every span, including full gen_ai.input.messages/
  // gen_ai.output.messages JSON blobs, is both noisy and a real perf/PII
  // concern under real traffic.
  if (process.env.DEBUG_TRACING === "1") {
    processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // Useful APL queries once data is flowing (Axiom's UI, against AXIOM_DATASET):
  //
  //   Error rate by operation:
  //     summarize errors = countif(status_code == "ERROR"), total = count() by name
  //     | extend error_rate = errors / total
  //
  //   Guests messaged today (dedupes by phone, see webhook.record_inbound_message's
  //   gca.phone attribute in src/app/api/webhook/whatsapp/route.ts):
  //     where _time > ago(1d) and name == "webhook.record_inbound_message"
  //     | summarize dcount(['attributes.gca.phone'])
  //
  //   Requests that died before ever reaching Inngest — traces with
  //   webhook.record_inbound_message but no webhook.enqueue_inngest child span.

  if (processors.length === 0) {
    console.warn("[instrumentation] No tracing backend configured — no SpanProcessor registered");
    return;
  }

  // NOTE: this app's installed @opentelemetry/sdk-trace-base resolved to
  // v2.10.0, whose BasicTracerProvider is immutable (span processors are a
  // constructor-only `spanProcessors` array — there's no addSpanProcessor()
  // method, unlike the v1.x API @braintrust/otel's README examples show).
  // Configuring it via the constructor array below is the v2-correct
  // equivalent of provider.addSpanProcessor(...) calls.
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "guest-communication-agent",
    }),
    spanProcessors: processors,
  });

  trace.setGlobalTracerProvider(provider);

  // Heartbeat span: the Axiom "dead-man's-switch" monitor watching this
  // dataset needs to tell "the whole pipeline is dark" apart from "nobody
  // happened to message in the last N minutes" — this app's real traffic is
  // low and sporadic, so a plain "zero events in N minutes" check would
  // false-alarm constantly on an otherwise-healthy system. Emitting a
  // synthetic span on a fixed timer, independent of any guest/business
  // activity, gives the monitor something to watch that isn't at the mercy of
  // real traffic. Only runs when the Axiom processor above was actually
  // configured — no Axiom backend means nothing to heartbeat to, and in
  // dev/test that branch may not even run, which is fine too (no heartbeat
  // needed there).
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
