import asyncio
import sys
from collections.abc import Awaitable, Callable

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import Span, Status, StatusCode

# The per-request budget for flush_tracing below. Generous enough for one
# Axiom round trip, short enough that a stalled exporter can't hold a
# Telegram webhook response open until Telegram gives up and retries it.
REQUEST_FLUSH_TIMEOUT_MS = 2_000

# Vercel documents a 500ms window between SIGTERM and the instance being
# killed; staying under it means the shutdown flush either finishes or is
# abandoned on our terms rather than mid-write.
SHUTDOWN_FLUSH_TIMEOUT_MS = 400

# Unlike guest-communication-agent's tracing.py, this app has no Inngest
# steps and no cross-process replay to guard against — every request is
# handled synchronously, start to finish, in one process. That removes the
# entire reason GCA needs explicit TraceAnchor threading: OTel's own ambient
# context (managed by start_as_current_span) is enough for a child span to
# nest under whichever span is already open, and a fresh root starts
# automatically when nothing is. One helper covers both cases.
tracer = trace.get_tracer("telegram-router")


async def with_span[T](
    name: str,
    attributes: dict[str, str | bool | int | float],
    fn: Callable[[Span], Awaitable[T]],
) -> T:
    # start_as_current_span's default context-manager behavior already
    # records an exception raised inside the block, sets the span status to
    # ERROR, ends the span, and re-raises — exactly the contract this helper
    # needs, so there is no manual try/except/finally to write here.
    with tracer.start_as_current_span(name, attributes=attributes) as span:
        return await fn(span)


# Marks a span ERROR without throwing — for call sites that already catch a
# failure and downgrade it to a `{ ok: False, error }` return value (e.g.
# every telegram.py send helper, gca.py's relay calls) rather than propagate
# an exception. Makes the failure visible on the trace without changing
# existing control flow.
#
# Accepts either the real caught exception from an `except Exception as err`
# block or a plain semantic string — call sites that already have a real
# exception in scope can hand it straight through instead of pre-extracting
# `str(err)` and losing its real traceback. An already-BaseException value is
# recorded as-is (real traceback preserved); anything else (a plain string,
# or any other non-exception value) still gets wrapped in a synthetic
# `Exception(...)` exactly as before — there's no real traceback to preserve
# for those.
def mark_span_failed(span: Span, message_or_error: object) -> None:
    if isinstance(message_or_error, BaseException):
        span.record_exception(message_or_error)
        span.set_status(Status(StatusCode.ERROR, str(message_or_error)))
        return
    message = str(message_or_error)
    span.record_exception(Exception(message))
    span.set_status(Status(StatusCode.ERROR, message))


# The counterpart of guest-communication-agent's flushTracing() (see that
# app's src/instrumentation.ts), for the same reason and with the same
# contract. This app's spans go through a BatchSpanProcessor, which buffers
# them and exports on its own internal timer. On a Vercel Function nothing
# guarantees that timer fires before the instance goes away, so buffered
# spans are silently dropped; forcing a flush makes export a property of the
# request rather than of how long the instance happens to live.
#
# Best-effort, exactly like GCA's: a flush failure is swallowed and logged,
# never re-raised. It must not turn an otherwise-successful request into a
# failed HTTP response.
async def flush_tracing(timeout_millis: int = REQUEST_FLUSH_TIMEOUT_MS) -> None:
    provider = trace.get_tracer_provider()
    # GCA's `if (!globalProvider) return`, restated: without a lifespan there
    # is no SDK provider, only the API's no-op one, which has nothing to
    # flush. tests/conftest.py's ASGITransport never runs the lifespan, so
    # this is the branch every existing test takes. isinstance rather than
    # hasattr/getattr — getattr returns Any and mypy --strict rejects calling
    # it.
    if not isinstance(provider, TracerProvider):
        return
    try:
        # force_flush is synchronous and blocks on the exporter's HTTP round
        # trip; calling it bare here would stall the event loop, and with it
        # every concurrent request, for that whole duration.
        await asyncio.to_thread(provider.force_flush, timeout_millis)
    except Exception as err:  # noqa: BLE001
        print(f"[tracing] flush_tracing failed: {err}", file=sys.stderr)
