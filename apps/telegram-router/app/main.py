import asyncio
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
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

HEARTBEAT_INTERVAL_SECONDS = 5 * 60


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

    # Heartbeat span for the Axiom dead-man's-switch monitor — this app's
    # real traffic is low and sporadic, so "zero events in N minutes" would
    # false-alarm on an otherwise-healthy system. Only runs when the Axiom
    # processor above was actually configured.
    heartbeat_task: asyncio.Task[None] | None = None
    if axiom_configured:
        heartbeat_tracer = trace.get_tracer("instrumentation-heartbeat")

        async def _heartbeat() -> None:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                heartbeat_tracer.start_span("instrumentation.heartbeat").end()

        heartbeat_task = asyncio.create_task(_heartbeat())

    print("[main] Tracing initialized", file=sys.stderr)

    try:
        yield
    finally:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
        provider.shutdown()


app = FastAPI(lifespan=lifespan)
app.include_router(telegram_webhook.router)
app.include_router(owner_nudges.router)
