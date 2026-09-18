from collections.abc import Awaitable, Callable

from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

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
