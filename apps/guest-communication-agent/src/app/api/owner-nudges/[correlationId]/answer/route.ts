import type { Span } from "@opentelemetry/api";
import { type NextRequest, NextResponse } from "next/server";
import { handleMissingInfoReplyReceived } from "@/agent/tools/missing-info";
import { requireApiKey } from "@/lib/auth";
import { markPendingOwnerDecisionRelayed } from "@/lib/pending-owner-decisions";
import {
  consumeMissingInfoTraceAnchor,
  markSpanFailed,
  startTraceRoot,
  withTurnSpan,
} from "@/lib/tracing";

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
 * original guest turn's trace via Inngest's event.data (see
 * startTraceRoot's own comment) — it only ever receives `correlationId` (a
 * plain string), often hours later, from a completely separate process
 * (telegram-router's webhook, relaying the owner's reply), possibly a
 * different server instance. run-turn.ts's runMissingInfo works around this
 * by writing its gen_ai.tool.missing_info span's real {traceId, spanId} to a
 * small DB table (missing_info_trace_anchors) keyed by this same
 * correlationId, right when that span is created — see
 * tracing.ts's recordMissingInfoTraceAnchor/consumeMissingInfoTraceAnchor
 * and the migration's own comment for why a DB lookup was chosen over
 * threading the anchor through telegram-router's `[ref:...]` tag mechanism
 * (that would require changing a separate app; this doesn't).
 * consumeMissingInfoTraceAnchor below reads (and deletes) that row. If found,
 * the embedding step's span nests as a real child of the original
 * gen_ai.tool.missing_info span via withTurnSpan. If not found (write
 * failed, row already consumed by a duplicate call, or the anchor's
 * best-effort write simply never landed — see recordMissingInfoTraceAnchor's
 * own reliability caveat), this falls back to its own small disconnected
 * trace root (startTraceRoot) instead, tagged with gca.correlation_id so it
 * can still be found and manually cross-referenced against the original
 * turn's trace by that shared id. Either way the span itself is named
 * "gen_ai.embed.missing_info_answer" — the "gen_ai." prefix alone is what
 * clears @braintrust/otel's export filter (see tracing.ts's attribute-
 * namespace comment block), no braintrust.tags trick needed.
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
    await startTraceRoot(
      "owner_nudges.answer.rejected",
      { "http.status_code": 401 },
      async (span) => {
        markSpanFailed(span, "Unauthorized — invalid or missing X-API-Key");
      },
    );
    return unauthorized;
  }

  const { correlationId } = await params;

  const body = await request.json().catch(() => null);
  const rawAnswer = body?.answer;
  const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
  if (!answer) {
    return NextResponse.json({ error: "Missing answer in request body" }, { status: 400 });
  }

  // Real work + real span attributes, shared by both the nested (anchor
  // found) and disconnected-root (anchor missing) cases below — only how the
  // span is parented differs, not what it records.
  async function embedAndRecordAnswer(span: Span) {
    span.setAttribute("gca.correlation_id", correlationId);
    span.setAttribute("gca.tool.input", answer);
    span.setAttribute("braintrust.input", answer);
    const { documentId, embeddingDimensions } = await handleMissingInfoReplyReceived({
      correlationId,
      answer,
    });
    const output = JSON.stringify({ documentId, embeddingDimensions });
    span.setAttribute("gca.tool.output", output);
    span.setAttribute("braintrust.output", output);
  }

  try {
    const toolAnchor = await consumeMissingInfoTraceAnchor(correlationId);
    if (toolAnchor) {
      await withTurnSpan(
        toolAnchor,
        "gen_ai.embed.missing_info_answer",
        { "gen_ai.operation.name": "embed" },
        embedAndRecordAnswer,
      );
    } else {
      await startTraceRoot(
        "gen_ai.embed.missing_info_answer",
        { "gen_ai.operation.name": "embed" },
        embedAndRecordAnswer,
      );
    }
    // Best-effort bookkeeping, after the real KB-embed/Inngest-send work
    // above has already succeeded — never allowed to fail this request (see
    // markPendingOwnerDecisionRelayed's own doc comment). No matching row is
    // a real, expected case (e.g. a duplicate/late POST after the row was
    // already resolved), not something to log as an error here — the helper
    // itself already logs any actual write failure.
    await markPendingOwnerDecisionRelayed(correlationId, { answer });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
