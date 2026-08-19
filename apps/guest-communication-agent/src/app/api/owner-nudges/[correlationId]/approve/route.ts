import { type NextRequest, NextResponse } from "next/server";
import { handleBookingLinkApprovalReceived } from "@/agent/tools/booking";
import { requireApiKey } from "@/lib/auth";
import { markSpanFailed, startTraceRoot } from "@/lib/tracing";

/**
 * Closes the human-in-the-loop for a send_booking_link owner nudge once the
 * owner taps ✅ Approve / ❌ Reject on Telegram. A thin trigger: auth/parsing/
 * status mapping live here, actual Inngest send logic lives in
 * handleBookingLinkApprovalReceived.
 *
 * The dynamic segment is the suspended run-guest-turn Inngest function's own
 * correlation id, same as .../answer/route.ts's — there is no escalations
 * DB row, so there's nothing to look up by. Unlike missing_info's
 * flow, the correlationId doesn't travel via a `[ref:...]` text tag here — it
 * rides directly in the Telegram button's callback_data (see
 * apps/telegram-router's owner-nudges route/webhook route), which is more
 * reliable than parsing free text.
 *
 * Request body: `{ approved: boolean }`.
 *
 * - 400 if `approved` is missing or not a boolean.
 * - 500 if the Inngest send itself errors.
 *
 * Tracing: same reasoning as .../answer/route.ts — this handler can't join
 * the original guest turn's trace (it only ever receives a plain
 * correlationId string, often much later, from a separate process), so it
 * starts its OWN small trace root (startTraceRoot), tagged with
 * gca.correlation_id so it can still be manually cross-referenced against the
 * original turn's trace by that shared id.
 * - A duplicate/late POST for the same correlation id is safe to retry:
 *   sending an event nobody's waiting on isn't an error to Inngest, it's
 *   simply never consumed by anything — there's no way to honestly tell a
 *   late decision apart from a real resume (see
 *   handleBookingLinkApprovalReceived's own comment), so this route doesn't
 *   report a `resumed` flag either. There's no 409/already-resolved concept
 *   — there's no row to hold that state.
 * - Otherwise `{ ok: true }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ correlationId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    await startTraceRoot(
      "owner_nudges.approve.rejected",
      { "http.status_code": 401 },
      async (span) => {
        markSpanFailed(span, "Unauthorized — invalid or missing X-API-Key");
      },
    );
    return unauthorized;
  }

  const { correlationId } = await params;

  const body = await request.json().catch(() => null);
  const approved = body?.approved;
  if (typeof approved !== "boolean") {
    return NextResponse.json(
      { error: "Missing/invalid approved in request body" },
      { status: 400 },
    );
  }

  try {
    await startTraceRoot(
      "owner_nudges.handle_approval",
      { "gca.correlation_id": correlationId },
      () => handleBookingLinkApprovalReceived({ correlationId, approved }),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
