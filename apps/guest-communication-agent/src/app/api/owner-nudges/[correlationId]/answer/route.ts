import { type NextRequest, NextResponse } from "next/server";
import { handleMissingInfoReplyReceived } from "@/agent/tools/missing-info";
import { requireApiKey } from "@/lib/auth";
import { startTraceRoot } from "@/lib/tracing";

/**
 * Closes the human-in-the-loop for a missing_info owner nudge once the owner
 * replies on Telegram. A thin trigger: auth/parsing/status mapping live
 * here, actual KB-embed + Inngest send logic lives in
 * handleMissingInfoReplyReceived.
 *
 * The dynamic segment is the suspended run-guest-turn Inngest function's own
 * correlation id — there is no escalations DB row, so there's nothing to
 * look up by. apps/telegram-router's webhook route extracts this
 * id straight out of the owner's Telegram reply (the `[ref:<correlationId>]`
 * tag embedded in the original nudge text, see
 * owner-nudge.ts/missing-info.ts) and calls this route directly with it.
 *
 * Request body: `{ answer: string }`.
 *
 * - 400 if `answer` is missing/blank.
 * - 500 if the KB embed/insert fails, or the Inngest send itself errors.
 *
 * Tracing: unlike every other stage of a turn, this handler can't join the
 * original guest turn's trace — it only ever receives `correlationId` (a
 * plain string, not the original webhook's real TraceAnchor), often hours
 * later, from a completely separate process (telegram-router's webhook,
 * relaying the owner's reply). There's no live/derivable link back to the
 * original trace's real {traceId, spanId} without either persisting it
 * somewhere keyed by correlationId (a DB dependency this flow deliberately
 * avoids) or having telegram-router carry it through the `[ref:...]` tag too
 * (a cross-app change). So this handler starts its OWN small trace root
 * instead (startTraceRoot) — tagged with gca.correlation_id so it can still
 * be found and manually cross-referenced against the original turn's trace
 * by that shared id, just not auto-nested under it.
 * - A duplicate/late POST for the same correlation id is safe to retry:
 *   sending an event nobody's waiting on isn't an error to Inngest, it's
 *   simply never consumed by anything. There's no way to honestly tell a
 *   late reply apart from a real resume (see handleMissingInfoReplyReceived's
 *   own comment), so this route reports no `resumed` flag and has no
 *   409/already-resolved concept — there's no row to hold that state.
 * - Otherwise `{ ok: true }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ correlationId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { correlationId } = await params;

  const body = await request.json().catch(() => null);
  const rawAnswer = body?.answer;
  const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
  if (!answer) {
    return NextResponse.json({ error: "Missing answer in request body" }, { status: 400 });
  }

  try {
    await startTraceRoot("owner_nudges.handle_reply", { "gca.correlation_id": correlationId }, () =>
      handleMissingInfoReplyReceived({ correlationId, answer }),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
