import { embed, tool } from "ai";
import { z } from "zod";
import { flushTracing } from "@/instrumentation";
import { inngest } from "@/lib/inngest";
import { openrouter } from "@/lib/openrouter";
import {
  insertPendingOwnerDecision,
  resolvePendingOwnerDecisionByCorrelationId,
} from "@/lib/pending-owner-decisions";
import { createAdminClient } from "@/lib/supabase";
import {
  recordMissingInfoTraceAnchor,
  steppedSpan,
  type TraceAnchor,
  updateSpanIO,
  withSpan,
} from "@/lib/tracing";
import type { ToolContext } from "./config";
import { requestOwnerNudge } from "./owner-nudge";

// Consolidated home for the missing_info tool: the schema/declaration the
// model sees, the shared event/timeout constants, the tool's real dispatch
// (runMissingInfo below — this app's run<ToolName> convention, see
// wants-human.ts's runWantsHuman for the model this follows), and both
// non-step branches of what happens once a nudge is settled — reply arrives
// (handleMissingInfoReplyReceived) or doesn't (handleMissingInfoNoReply).
// POST /api/owner-nudges/[correlationId]/answer is a thin trigger that calls
// handleMissingInfoReplyReceived, not its own logic.
//
// runMissingInfo's own step/span/Inngest usage is a deliberate exception to
// the general "tool files stay pure" posture most of src/agent/tools/*.ts
// holds to (see run-turn.ts's comment near `tools`) — missing_info's
// suspend/resume dispatch is real durability plumbing, and the established
// pattern is that it lives inside the tool's own run<ToolName>, not in
// run-turn.ts's dispatch loop. handleMissingInfoReplyReceived/
// handleMissingInfoNoReply stay free of step/Inngest-function usage of their
// own; inngest.send below is a plain event send, not a step. The withSpan
// import on handleMissingInfoReplyReceived's own DB write is the same narrow
// exception property-question.ts documents near its db.matchDocuments call:
// it wraps only that one DB write, never touches step/Inngest, and nests
// under the trace root the calling route
// (owner-nudges/[correlationId]/answer/route.ts) already opens.
//
// There is no escalations DB row — the correlation id itself, embedded in
// the Telegram nudge text as `[ref:<correlationId>]` and echoed back via the
// owner's reply, is the only correlation key (see owner-nudge.ts and
// apps/telegram-router's webhook route).

const missingInfoSchema = z.object({
  reason: z
    .string()
    .describe(
      "Brief paraphrase of the guest's question you could not answer (answerPropertyQuestion came back empty/insufficient). This is what the owner sees in the Telegram alert, so make it clear enough for them to answer without more context.",
    ),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runMissingInfo below by name (tool name "missing_info", matching this
// literal key in run-turn.ts's `tools` ToolSet).
export const missingInfo = tool({
  description:
    "Use when you could not find an answer to the guest's question anywhere in the property knowledge base. Alerts the owner to answer directly; once they do, their answer is added to the knowledge base for future guests.",
  inputSchema: missingInfoSchema,
});

// The event runMissingInfo below waits for and handleMissingInfoReplyReceived
// sends — shared as a constant so the two ends can't drift apart.
export const OWNER_NUDGE_ANSWERED_EVENT = "gca/owner-nudge.answered";

// 24h — same order of magnitude as harness-engineering's APPROVAL_TIMEOUT_S:
// long enough for a human reply, but the guest still deserves a response
// within their own conversation rather than waiting forever. The sole
// step.waitForEvent timeout runMissingInfo below uses. Not exported — only
// used within this file now that runMissingInfo lives here too.
const MISSING_INFO_REPLY_TIMEOUT = "24h";

// "Reply received" branch: embeds the owner's answer into the KB (same
// embedding model/table property-question.ts reads from), then sends
// OWNER_NUDGE_ANSWERED_EVENT so a suspended run-guest-turn step.waitForEvent
// call — if one is still actually waiting — picks it up. Embed happens
// first and deliberately — by the time the event is sent the answer is
// already searchable.
//
// correlationId comes straight from the Telegram-embedded `[ref:...]` tag
// (extracted by telegram-router's webhook route) — no DB lookup involved.
//
// Throws if the KB write fails, before the event is ever sent. inngest.send()
// gives no signal about whether a matching waiter still exists — sending an
// event nobody's waiting on isn't an error, it's simply never consumed by
// anything. This resolves once the KB write has succeeded and the event has
// been accepted by Inngest, nothing more; a duplicate or late call is a safe
// no-op.
//
// Returns the inserted document's real row id and the embedding's real
// dimension count — not used by this function's own logic, but the caller
// (the owner-nudges answer route) needs real output to attach to this step's
// gen_ai.embed.missing_info_answer span; see that route's own comment.
export async function handleMissingInfoReplyReceived(params: {
  correlationId: string;
  answer: string;
  // The guest's original question, when available (see telegram-router's
  // extractMissingInfoQuestion) — used as this document's heading, same
  // `<heading>\n\n- <content>` shape stored.documents.content has for the
  // knowledge-base .md files (see embed.ts's chunkByHeaders — the `##`/`#`
  // markdown marker is stripped before storage there too), so this stays
  // consistent with the rest of the corpus for vector search. Falls back to
  // the bare answer when absent (e.g. an older nudge, or extraction failed).
  question?: string;
}): Promise<{ documentId: number; embeddingDimensions: number }> {
  const { correlationId, answer, question } = params;
  const supabase = createAdminClient();
  const content = question ? `${question}\n\n- ${answer}` : answer;

  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: content,
  });

  const inserted = await withSpan("db.insertDocument", { "db.table": "documents" }, async () => {
    const { data, error: insertError } = await supabase
      .from("documents")
      .insert({
        content,
        embedding: JSON.stringify(embedding),
        metadata: { source: "owner_nudge_answer" },
      })
      .select("id")
      .single();
    if (insertError || !data) {
      throw new Error(insertError?.message ?? "documents insert returned no row");
    }
    return data;
  });

  await inngest.send({ name: OWNER_NUDGE_ANSWERED_EVENT, data: { correlationId, answer } });

  return { documentId: inserted.id as number, embeddingDimensions: embedding.length };
}

// Stub: only logs. No timeout/expiry side effect (re-nudging owner) exists
// yet. Called by runMissingInfo below (wrapped in its own step/span there,
// since this function itself must stay step/span-free) once its
// step.waitForEvent times out.
export async function handleMissingInfoNoReply(params: { correlationId: string }): Promise<void> {
  const { correlationId } = params;
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for correlationId ${correlationId} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT}, falling back to the owner-notified response for this turn.`,
  );
}

// The tool's real dispatch: this app's run<ToolName> convention (see
// wants-human.ts's runWantsHuman for the model this follows) — every tool's
// own execution lives in its own file under this name, called directly from
// run-turn.ts's runToolCall(). Unlike wants_human's one-way alert,
// missing_info's full suspend/resume dispatch: creates the real
// gen_ai.tool.missing_info execution span FIRST (its `input` — the model's
// `reason` — is the one thing already known at this point), then sends the
// owner nudge and genuinely suspends via step.waitForEvent until the owner
// replies (handleMissingInfoReplyReceived above, called from the API route,
// sends OWNER_NUDGE_ANSWERED_EVENT) or the timeout elapses, running the
// no-reply-timeout fallback step in that case. Called from run-turn.ts's
// SELF_STEPPED_TOOLS branch, never nested inside another step.run — Inngest
// doesn't support calling a step tool from inside another step.run()'s
// callback, the callback must be a self-contained unit of work.
export async function runMissingInfo(
  args: { reason: string },
  context: ToolContext,
): Promise<{ escalated: true; answer: string } | { escalated: true; message: string }> {
  const { conversationId, phone, step, correlationId, traceAnchor } = context;

  // Created FIRST, before the nudge, so owner_nudge.missing_info/
  // missing_info.no_reply below nest as its real children instead of
  // siblings of the turn's own anchor — same shape every other tool's
  // execution span already has relative to its own sub-steps. Only `fn`'s
  // return value (the real OTel-generated span id, same pattern
  // runAgentTurn's own "start-trace" step uses for guestTurnSpanId) survives
  // this step — the span itself has already closed by the time this
  // resolves, since no live Span object can survive across this (or any)
  // Inngest step boundary. `output` isn't set here because it isn't known
  // yet; it's patched in retroactively, once the real result exists, via
  // updateSpanIO at the bottom of this function — see that call's own
  // comment for the same reliability caveat updateSpanIO's own doc comment
  // already flags.
  const toolSpanId = await steppedSpan(
    step,
    "tool-missing_info",
    traceAnchor,
    "gen_ai.tool.missing_info",
    {
      "gen_ai.tool.name": "missing_info",
      "gen_ai.operation.name": "execute_tool",
      "gca.tool.input": JSON.stringify(args),
      "braintrust.input": JSON.stringify(args),
    },
    async (span) => span.spanContext().spanId,
  );
  // Synchronous, awaited flush (not the routes' non-blocking after()) —
  // guarantees this span's own OTel export lands before this function's own
  // later updateSpanIO patch (on the "escalated" happy path, or the no-reply
  // timeout path) can fire and race it. See wants-human.ts's own
  // runWantsHuman's identical flushTracing() call for the full reasoning.
  await flushTracing();
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

  // Best-effort write, own step (not a span — this is pure DB bookkeeping,
  // not something worth showing in Braintrust's UI) — see
  // recordMissingInfoTraceAnchor's own doc comment in tracing.ts for what
  // this is for (letting the owner-nudges answer route, a separate HTTP
  // request that may run hours later on a different server instance, nest
  // its own embedding-step span under toolAnchor) and its known
  // orphaned-row gap when the owner never replies. Only written when a real
  // correlationId exists — every real run does supply one (see
  // run-turn.ts's GuestTurnRequestedEventData), this guard is for
  // hypothetical callers outside a live run (see ToolContext.correlationId's
  // own comment).
  if (correlationId) {
    await step.run("record-missing-info-trace-anchor", () =>
      recordMissingInfoTraceAnchor(correlationId, toolAnchor),
    );
  }

  // Its own step, distinct from "wait-for-owner-answer" below — sending the
  // nudge and waiting for the reply are two different kinds of operation,
  // each needing its own memoized step id (see steppedSpan's doc comment in
  // tracing.ts for why un-stepped code would otherwise re-send this real
  // Telegram nudge on every replay).
  // braintrust.tags is also what gets this span past @braintrust/otel's
  // export filter at all (see tracing.ts's attribute-namespace comment
  // block) — same reason wants-human.ts's own runWantsHuman nudge span sets
  // it.
  const nudged = await steppedSpan(
    step,
    "owner-nudge-missing-info",
    toolAnchor,
    "owner_nudge.missing_info",
    {
      "gca.conversation_id": conversationId,
      "gca.phone": phone,
      "braintrust.tags": ["missing_info"],
    },
    () =>
      requestOwnerNudge({
        conversationId,
        phone,
        reason: args.reason,
        reasonCategory: "missing_info",
        correlationId,
        step,
      }),
  );

  // Every exit path below funnels into this one shared value instead of
  // returning early, so there's a single result to both hand back to the
  // model and retroactively patch onto the tool-call span's output below —
  // starts as the nudge-failed/timeout fallback since that's also the
  // fallback for the "nudge never sent" branch that skips the block below
  // entirely. Branches on `nudged` (already known at this point) so a failed
  // nudge gets an honest message instead of falsely claiming the owner was
  // notified.
  let result: { escalated: true; answer: string } | { escalated: true; message: string } = nudged
    ? { escalated: true, message: "The owner has been notified and will be in touch shortly." }
    : {
        escalated: true,
        message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
      };

  // Nudge failed to send — skip straight to the same fallback a timeout
  // would produce; there's no point suspending if the owner was never told.
  if (nudged) {
    // Best-effort bookkeeping (see insertPendingOwnerDecision's own doc
    // comment) — own step, only reached once the nudge is confirmed sent.
    // Guarded on correlationId same as recordMissingInfoTraceAnchor's own
    // call site above: only real runs supply one (see
    // ToolContext.correlationId's own comment); there's nothing to key a row
    // on for hypothetical callers outside a live run.
    if (correlationId) {
      await step.run("record-pending-decision", () =>
        insertPendingOwnerDecision({
          correlationId,
          toolName: "missing_info",
          conversationId,
          phone,
          reason: args.reason,
        }),
      );
    }

    const waitResult = await step.waitForEvent("wait-for-owner-answer", {
      event: OWNER_NUDGE_ANSWERED_EVENT,
      match: "data.correlationId",
      timeout: MISSING_INFO_REPLY_TIMEOUT,
    });

    const answer = (waitResult?.data.answer as string | undefined) ?? null;
    if (answer !== null) {
      // Embedding already happened in handleMissingInfoReplyReceived before
      // OWNER_NUDGE_ANSWERED_EVENT delivered this answer here — do not
      // re-embed here.
      result = { escalated: true, answer };
      // Own step — same replay-safety reasoning as the nudge-send step above.
      // Mirrors missing-info-no-reply's own marker span, for the symmetric
      // "an answer was received and consumed" case.
      await steppedSpan(
        step,
        "missing-info-answer-received",
        toolAnchor,
        "missing_info.answer_received",
        { "gca.correlation_id": correlationId ?? "unknown", "braintrust.tags": ["missing_info"] },
        async () => {},
      );
      if (correlationId) {
        await step.run("resolve-pending-decision", () =>
          resolvePendingOwnerDecisionByCorrelationId(correlationId, "answered"),
        );
      }
    } else {
      console.warn(
        `[missing-info] runMissingInfo timed out after ${MISSING_INFO_REPLY_TIMEOUT} waiting for correlationId ${correlationId ?? "unknown"}'s reply`,
      );
      // Own step — same replay-safety reasoning as the nudge-send step above.
      // braintrust.tags clears the same export filter as the nudge span above
      // (see tracing.ts's attribute-namespace comment block) — this isn't an
      // approve/reject decision (approval-gate.ts's braintrust.approval_decision
      // doesn't apply here; a missing_info timeout means "gave up waiting for
      // the KB answer," not a rejected gate), so it reuses the sibling nudge
      // span's tagging mechanism instead.
      await steppedSpan(
        step,
        "missing-info-no-reply",
        toolAnchor,
        "missing_info.no_reply",
        {
          "gca.timeout": MISSING_INFO_REPLY_TIMEOUT,
          "braintrust.tags": ["missing_info"],
          "gca.correlation_id": correlationId ?? "unknown",
        },
        () => handleMissingInfoNoReply({ correlationId: correlationId ?? "unknown" }),
      );
      if (correlationId) {
        await step.run("resolve-pending-decision-timeout", () =>
          resolvePendingOwnerDecisionByCorrelationId(correlationId, "timeout"),
        );
      }
      // Timed out — handleMissingInfoNoReply already ran above; result keeps
      // its default fallback-message value.
    }
  }

  // Retroactively patches the tool-call span's real output now that it's
  // known — missing_info's actual resolution (the owner's real answer, or
  // the fallback message) isn't knowable until after step.waitForEvent above
  // has already resolved (or was skipped), well after the span itself was
  // created and closed above, so there's no live Span object left to call
  // span.setAttribute on. Same mechanism runAgentTurn's own
  // "braintrust.guest_turn" root marker span already uses for its output —
  // both flush synchronously right after span creation (see this function's
  // own flushTracing() call above), so this patch can't be clobbered by a
  // later out-of-order OTel export (see updateSpanIO's own doc comment for
  // that mechanism). Own step, not a span — patching a span isn't itself a
  // new event worth its own trace node.
  await step.run("update-missing-info-trace-io", () =>
    updateSpanIO(toolSpanId, { output: result }),
  );

  return result;
}
