import { embed, tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
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
import type { HitlDecision } from "./approval-gate";
import type { ToolContext } from "./config";
import { requestOwnerNudge } from "./owner-nudge";

// Consolidated home for the missing_info tool: the schema/declaration the
// model sees, the shared event/timeout constants, the tool's real dispatch
// (split into requestMissingInfoApproval's "calls human" half and
// runMissingInfo's "tool call" half below — this app's run<ToolName>
// convention, see wants-human.ts's runWantsHuman for the model this
// follows), and both non-step branches of what happens once a nudge is
// settled — reply arrives (handleMissingInfoReplyReceived) or doesn't
// (handleMissingInfoNoReply). POST /api/owner-nudges/[correlationId]/answer
// is a thin trigger that calls handleMissingInfoReplyReceived, not its own
// logic.
//
// requestMissingInfoApproval and runMissingInfo are NOT glued together by
// anything in this file — run-tool.ts's runTool dispatches to runMissingInfo
// directly (the same uniform way it dispatches to every other tool),
// receiving the owner's answer (from requestMissingInfoApproval's own
// HitlDecision.payload) as its own param. The two halves own two DIFFERENT
// spans, not one shared span: requestMissingInfoApproval creates its own
// hitl.missing_info gate span up front and patches IT with the not-approved
// outcome if the call is rejected/times out; runMissingInfo creates its own
// fresh gen_ai.tool.missing_info execution span, only once an answer
// actually exists, with real output known at creation time — same one-shot
// shape every plain tool's run<ToolName> already has (see
// tool-execution.ts's dispatchToolExecution). run-turn.ts's loop only
// sequences "approve, then — if approved — call the tool" (its own
// NEEDS_APPROVAL branch); it does no span/step wrapping of its own for
// either half.
//
// requestMissingInfoApproval's own step/span/Inngest usage is a deliberate
// exception to the general "tool files stay pure" posture most of
// src/agent/tools/*.ts holds to (see run-turn.ts's comment near `tools`) —
// missing_info's suspend/resume dispatch is real durability plumbing, and
// the established pattern is that it lives inside the tool's own file, not
// in run-turn.ts's dispatch loop. handleMissingInfoReplyReceived/
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

// The event requestMissingInfoApproval below waits for and
// handleMissingInfoReplyReceived sends — shared as a constant so the two
// ends can't drift apart.
export const OWNER_NUDGE_ANSWERED_EVENT = "gca/owner-nudge.answered";

// 24h — same order of magnitude as harness-engineering's APPROVAL_TIMEOUT_S:
// long enough for a human reply, but the guest still deserves a response
// within their own conversation rather than waiting forever. The sole
// step.waitForEvent timeout requestMissingInfoApproval below uses. Not
// exported — only used within this file.
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
// yet. Called by requestMissingInfoApproval below (wrapped in its own
// step/span there, since this function itself must stay step/span-free) once
// its step.waitForEvent times out.
export async function handleMissingInfoNoReply(params: { correlationId: string }): Promise<void> {
  const { correlationId } = params;
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for correlationId ${correlationId} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT}, falling back to the owner-notified response for this turn.`,
  );
}

// missing_info's "calls human" half: creates the real hitl.missing_info gate
// span FIRST (its `input` — the model's `reason` — is the one thing already
// known at this point), sends the owner nudge, and genuinely suspends via
// step.waitForEvent until the owner replies (handleMissingInfoReplyReceived
// above, called from the API route, sends OWNER_NUDGE_ANSWERED_EVENT) or the
// timeout elapses. Patches its own span with the not-approved fallback before
// returning on either non-approved exit path (nudge failed, or timed out) —
// it already knows that output at that point, no reason to hand it back
// unpatched. Deliberately does NOT patch anything on the approved case,
// though: this span's job is done once an answer exists — the real
// answer-embedding result lands on runMissingInfo's own, separate,
// freshly-created execution span instead, once run-tool.ts's runTool calls
// it (see that function's own comment for why it's a different span, not
// this one reused). The shared HitlDecision<string> contract (see
// approval-gate.ts) `payload` is the owner's real answer when `approved` is
// true.
//
// Two distinct not-approved messages, both preserved exactly as before this
// split: a nudge that failed to send gets the honest "couldn't reach the
// owner" message (no point suspending on a reply the owner was never told to
// give); a nudge that sent but timed out still gets "owner has been
// notified" — that claim stays true even though this specific KB answer
// never arrived in time.
//
// Called from run-turn.ts's NEEDS_APPROVAL branch (via its own inline
// switch), never nested inside another step.run — Inngest doesn't support
// calling a step tool from inside another step.run()'s callback, the
// callback must be a self-contained unit of work.
export async function requestMissingInfoApproval(
  args: { reason: string },
  context: ToolContext,
): Promise<HitlDecision<string>> {
  const { conversationId, phone, step, correlationId, traceAnchor } = context;

  // Created FIRST, before the nudge, so hitl.missing_info.nudge/
  // hitl.missing_info.no_reply below nest as its real children instead of
  // siblings of the turn's own anchor. This is the HITL gate span, NOT a
  // tool-execution span — it covers only "are we approved to run this tool",
  // which is why it's named hitl.missing_info rather than
  // gen_ai.tool.missing_info: the real execution span (created by
  // runMissingInfo below, only once an answer exists) is a separate span, a
  // sibling of this one under the turn, not its child — nesting the
  // nudge/decision wait under a span literally named "the tool call" would
  // misrepresent the sequence (approve, THEN call the tool) as the wait
  // happening inside the tool call. Only `fn`'s return value (the real
  // OTel-generated span id, same pattern runAgentTurn's own "start-trace"
  // step uses for guestTurnSpanId) survives this step — the span itself has
  // already closed by the time this resolves, since no live Span object can
  // survive across this (or any) Inngest step boundary. `output` isn't set
  // here because it isn't known yet — patched in retroactively via
  // updateSpanIO below, but only on the not-approved exit paths (see this
  // function's own top comment for why the approved path never patches this
  // span at all).
  const hitlSpanId = await steppedSpan(
    step,
    "hitl-missing_info",
    traceAnchor,
    "hitl.missing_info",
    {
      "gca.tool.input": JSON.stringify(args),
      "braintrust.input": JSON.stringify(args),
      "braintrust.tags": ["missing_info"],
    },
    async (span) => span.spanContext().spanId,
  );
  // Synchronous, awaited flush (not the routes' non-blocking after()) —
  // guarantees this span's own OTel export lands before the caller's own
  // later updateSpanIO patch (on either not-approved exit path) can fire and
  // race it. See wants-human.ts's own runWantsHuman's identical
  // flushTracing() call for the full reasoning.
  await flushTracing();
  const hitlAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: hitlSpanId };

  // Best-effort write, own step (not a span — this is pure DB bookkeeping,
  // not something worth showing in Braintrust's UI) — see
  // recordMissingInfoTraceAnchor's own doc comment in tracing.ts for what
  // this is for (letting the owner-nudges answer route, a separate HTTP
  // request that may run hours later on a different server instance, nest
  // its own embedding-step span under hitlAnchor) and its known
  // orphaned-row gap when the owner never replies. Only written when a real
  // correlationId exists — every real run does supply one (see
  // run-turn.ts's GuestTurnRequestedEventData), this guard is for
  // hypothetical callers outside a live run (see ToolContext.correlationId's
  // own comment).
  if (correlationId) {
    await step.run("record-missing-info-trace-anchor", () =>
      recordMissingInfoTraceAnchor(correlationId, hitlAnchor),
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
    "hitl-missing-info-nudge",
    hitlAnchor,
    "hitl.missing_info.nudge",
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

  // Nudge failed to send — skip straight to the same fallback a timeout
  // would produce; there's no point suspending if the owner was never told.
  // This outcome is fully known right here, so this function patches its own
  // span with it before returning, rather than handing an unpatched span back
  // for the caller to finish.
  if (!nudged) {
    const notApprovedOutput = {
      escalated: true,
      message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
    };
    await step.run("update-missing-info-trace-io", () =>
      updateSpanIO(hitlSpanId, { output: notApprovedOutput }),
    );
    return { approved: false, notApprovedOutput, hitlSpanId, hitlAnchor };
  }

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
    // Own step — same replay-safety reasoning as the nudge-send step above.
    // Mirrors hitl-missing-info-no-reply's own marker span, for the symmetric
    // "an answer was received and consumed" case.
    await steppedSpan(
      step,
      "hitl-missing-info-answer-received",
      hitlAnchor,
      "hitl.missing_info.answer_received",
      { "gca.correlation_id": correlationId ?? "unknown", "braintrust.tags": ["missing_info"] },
      async () => {},
    );
    if (correlationId) {
      await step.run("resolve-pending-decision", () =>
        resolvePendingOwnerDecisionByCorrelationId(correlationId, "answered"),
      );
    }
    return { approved: true, payload: answer, hitlSpanId, hitlAnchor };
  }

  console.warn(
    `[missing-info] requestMissingInfoApproval timed out after ${MISSING_INFO_REPLY_TIMEOUT} waiting for correlationId ${correlationId ?? "unknown"}'s reply`,
  );
  // Own step — same replay-safety reasoning as the nudge-send step above.
  // braintrust.tags clears the same export filter as the nudge span above
  // (see tracing.ts's attribute-namespace comment block, 4th bullet) — this
  // isn't an approve/reject decision (approval-gate.ts's
  // braintrust.approval_decision doesn't apply here; a missing_info timeout
  // means "gave up waiting for the KB answer," not a rejected gate), so it
  // reuses the sibling nudge span's tagging mechanism instead.
  await steppedSpan(
    step,
    "hitl-missing-info-no-reply",
    hitlAnchor,
    "hitl.missing_info.no_reply",
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
  // Same self-patching reasoning as the nudge-failed branch above.
  const notApprovedOutput = {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
  await step.run("update-missing-info-trace-io", () =>
    updateSpanIO(hitlSpanId, { output: notApprovedOutput }),
  );
  return { approved: false, notApprovedOutput, hitlSpanId, hitlAnchor };
}

// missing_info's "tool call" half — once an answer exists
// (requestMissingInfoApproval's `payload`), embedding it into the result is
// the entire real work; `args` isn't used in that computation, kept only so
// this matches every other tool's run<ToolName>(input, context) calling
// convention, since run-tool.ts's runTool dispatches to this the same
// uniform way it dispatches to every other tool. Unlike an earlier version of
// this function, this is now a genuine one-shot dispatch, the same shape
// every plain tool's own run<ToolName> already has (see current-date.ts's
// runGetCurrentDate/tool-execution.ts's dispatchToolExecution): the real
// answer is already known by the time this is ever called (only reached once
// requestMissingInfoApproval resolved `approved: true`), so
// gen_ai.tool.missing_info is created fresh here with real output set at
// creation — no pre-created span, no retroactive updateSpanIO patch, unlike
// requestMissingInfoApproval's own hitl.missing_info gate span above (which
// DOES need that, since it starts before the wait and must nest
// nudge/answer-received/no-reply spans under it as real children).
export async function runMissingInfo(
  args: { reason: string },
  context: ToolContext,
  answer: string,
): Promise<{ escalated: true; answer: string }> {
  return steppedSpan(
    context.step,
    "tool-missing_info",
    context.traceAnchor,
    "gen_ai.tool.missing_info",
    { "gen_ai.tool.name": "missing_info", "gen_ai.operation.name": "execute_tool" },
    (span) => dispatchToolExecution(span, args, async () => ({ escalated: true as const, answer })),
  );
}
