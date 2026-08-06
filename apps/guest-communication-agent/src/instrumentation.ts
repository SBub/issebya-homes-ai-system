// Next.js instrumentation hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) —
// register() runs once, before any other app code, in every server runtime
// Next.js boots. Lives in src/ (not the project root) because this app puts
// all its own code under src/ (see src/agent, src/lib, src/app) — same
// placement convention Next.js uses for src/middleware.ts.
//
// This wires OpenTelemetry tracing for Braintrust observability: every
// guest turn's full reasoning chain (system-prompt call, tool calls, the
// conversation summarizer call) lands in Braintrust as one trace. See
// src/lib/tracing.ts for the deterministic trace/span id scheme that makes
// this safe under Inngest's replay model.
//
// Deliberately built on vendor-neutral `@opentelemetry/api` with
// `@braintrust/otel`'s BraintrustSpanProcessor as the one SpanProcessor
// plugged into a standard OTel BasicTracerProvider — NOT Braintrust's
// proprietary initLogger/wrapAISDK/traced logging API. BraintrustSpanProcessor
// implements the standard OTel SpanProcessor interface, so adding a generic
// OTel Collector later (to fan out to Grafana/Datadog/whatever) is just
// another provider.addSpanProcessor(...) call below — zero changes to any
// instrumentation call site in application code (src/lib/tracing.ts,
// src/agent/run-turn.ts, src/agent/memory.ts).

// Guards against Next.js dev-mode hot-reload calling register() more than
// once — a second BraintrustSpanProcessor on the same provider would
// double-export every span.
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

  const apiKey = process.env.BRAINTRUST_API_KEY;
  const projectId = process.env.BRAINTRUST_PROJECT_ID;

  // Best-effort, unset means feature silently degrades — same convention as
  // e.g. TELEGRAM_ROUTER_API_URL in .env.example. Tracing is not required
  // for the agent to function; Braintrust prompt loading (loadPrompt in
  // run-turn.ts/memory.ts) already requires these same two vars for a
  // reply to be produced at all, so in practice this only trips in
  // environments that also can't run the agent — but guard independently
  // rather than assume that coupling.
  if (!apiKey || !projectId) {
    console.warn(
      "[instrumentation] Braintrust tracing disabled — BRAINTRUST_API_KEY/BRAINTRUST_PROJECT_ID not set",
    );
    return;
  }

  const { BasicTracerProvider } = await import("@opentelemetry/sdk-trace-base");
  const { trace } = await import("@opentelemetry/api");
  const { BraintrustSpanProcessor, setupOtelCompat } = await import("@braintrust/otel");

  setupOtelCompat(); // enables interop with Braintrust's own logger/traced API if anything else ever uses it — cheap, call it

  const braintrustProcessor = new BraintrustSpanProcessor({
    apiKey,
    // issebya's Braintrust org is EU-data-plane — the US default 421s
    // with DataPlaneRedirectError, same gotcha already documented in
    // scripts/migrate-prompts-to-braintrust.ts and .env.example.
    apiUrl: "https://api-eu.braintrust.dev",
    parent: `project_id:${projectId}`,
    // Keeps to gen_ai.*/llm.*/ai.*/braintrust.*/traceloop.*-prefixed spans
    // only — deliberate for "minimal", avoids clutter if broader auto-
    // instrumentation is ever added later.
    filterAISpans: true,
  });

  // NOTE: this app's installed @opentelemetry/sdk-trace-base resolved to
  // v2.10.0, whose BasicTracerProvider is immutable (span processors are a
  // constructor-only `spanProcessors` array — there's no addSpanProcessor()
  // method, unlike the v1.x API @braintrust/otel's README examples show).
  // Configuring it via the constructor array below is the v2-correct
  // equivalent of the README's provider.addSpanProcessor(...) call.
  const provider = new BasicTracerProvider({
    spanProcessors: [
      braintrustProcessor,
      // Extension point for later: fan out to a generic OTel Collector
      // (e.g. Grafana/Datadog) alongside Braintrust, with zero changes to
      // any instrumentation call site in application code — mirrors
      // @braintrust/otel's README "Combining with Other Exporters" section.
      //
      //   import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
      //   import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
      //   new BatchSpanProcessor(new OTLPTraceExporter({ url: collectorUrl })),
    ],
  });

  trace.setGlobalTracerProvider(provider);

  console.log("[instrumentation] Braintrust tracing initialized");
}
