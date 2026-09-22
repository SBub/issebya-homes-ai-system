import os
import sys
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Request, Response
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SimpleSpanProcessor,
)

from app.routers import owner_nudges, telegram_webhook
from app.tracing import SHUTDOWN_FLUSH_TIMEOUT_MS, flush_tracing


# Axiom-only for tracing, unlike guest-communication-agent's lifespan (which
# also wires a Braintrust processor for AI-call observability) — this app
# makes no gen_ai calls, so there's nothing for Braintrust to show.
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    provider = TracerProvider(resource=Resource.create({SERVICE_NAME: "telegram-router"}))

    axiom_token = os.getenv("AXIOM_TOKEN")
    axiom_dataset = os.getenv("AXIOM_DATASET")
    axiom_configured = bool(axiom_token and axiom_dataset)
    is_production = os.getenv("ENVIRONMENT") == "production"

    if axiom_configured:
        axiom_domain = os.getenv("AXIOM_DOMAIN") or "api.axiom.co"
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=f"https://{axiom_domain}/v1/traces",
                    headers={
                        "Authorization": f"Bearer {axiom_token}",
                        "X-Axiom-Dataset": axiom_dataset or "",
                    },
                )
            )
        )
    elif is_production:
        # Booting with zero observability in production must stay loud.
        raise RuntimeError(
            "[main] Axiom tracing is required in production but AXIOM_TOKEN/AXIOM_DATASET "
            "are not set"
        )
    else:
        print("[main] Axiom tracing disabled — AXIOM_TOKEN/AXIOM_DATASET not set", file=sys.stderr)

    # Dev-only, no-signup-required option: prints every span to stdout as it
    # ends. Never in production — spans here carry reply text.
    if os.getenv("DEBUG_TRACING") == "1":
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)

    # Sentry only ever runs in production, regardless of whether SENTRY_DSN
    # happens to be set locally — same policy as every other app in this
    # repo. Python's Sentry SDK has no equivalent of @sentry/nextjs's
    # auto-OTel-setup collision, so sentry_sdk.init() is a plain, independent
    # call that never touches the tracer provider set up above.
    sentry_dsn = os.getenv("SENTRY_DSN")
    if is_production and sentry_dsn:
        sentry_sdk.init(dsn=sentry_dsn, environment="production")
    elif is_production:
        print("[main] Sentry error tracking disabled — SENTRY_DSN not set", file=sys.stderr)

    # There is deliberately no heartbeat task here any more. It used to emit
    # an `instrumentation.heartbeat` span every five minutes to feed an Axiom
    # dead-man's-switch monitor. A Vercel Function only runs while it is
    # serving a request, so a timer-driven task cannot fire reliably and the
    # monitor it fed would alarm on a perfectly healthy system — the exact
    # false alarm it was added to prevent. Liveness is now an external uptime
    # ping against GET /api/health below. Don't re-add the task.

    print("[main] Tracing initialized", file=sys.stderr)

    try:
        yield
    finally:
        # Belt and braces only. Vercel caps shutdown cleanup at 500ms after
        # SIGTERM and doesn't surface anything printed during it, so this path
        # can neither be relied on nor debugged — the per-request middleware
        # below is what actually guarantees export. It is also why
        # provider.shutdown()'s own 30s default flush can't hang here: by this
        # point the queue is already empty.
        provider.force_flush(SHUTDOWN_FLUSH_TIMEOUT_MS)
        provider.shutdown()


app = FastAPI(lifespan=lifespan)
app.include_router(telegram_webhook.router)
app.include_router(owner_nudges.router)


# Force-flushing here was chosen over swapping BatchSpanProcessor for a
# SimpleSpanProcessor. Both get spans out before the instance freezes, but
# this one costs a single Axiom round trip per request instead of one per
# span — a single webhook request emits up to three (the update span, a
# Telegram-API span, a GCA-relay span) — keeps BatchSpanProcessor's batching
# inside the request, adds no per-span latency to the handler, and leaves the
# DEBUG_TRACING console processor and the production guard above untouched.
# It does not depend on the instance surviving the response.
#
# It runs after call_next returns, so the handler's spans have already ended
# and are queued, and it returns the untouched response object: the status
# code and body of both routes are unaffected, including owner_nudges.py's
# 500 branch and the webhook's always-200-once-authenticated rule.
@app.middleware("http")
async def flush_tracing_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    # flush_tracing already swallows its own failures; catching again here is
    # what makes "a flush can never change a response" a property of this
    # middleware rather than a property of the helper it happens to call. The
    # contract matters most on the webhook, where a 500 makes Telegram retry
    # the whole update.
    try:
        await flush_tracing()
    except Exception as err:  # noqa: BLE001
        print(f"[main] flush_tracing_middleware failed: {err}", file=sys.stderr)
    return response


# The target for the external uptime check that replaces the retired
# dead-man's-switch monitor. Unauthenticated by design (it exposes nothing)
# and deliberately not instrumented with with_span — it is polled on a
# schedule, and instrumenting it would fill the Axiom dataset with noise.
# It is not one of the two contract routes.
@app.get("/api/health")
async def health() -> dict[str, bool]:
    return {"ok": True}
