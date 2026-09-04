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

// The missing_info tool: its schema, requestMissingInfoApproval ("calls
// human") + runMissingInfo ("tool call") — split into two spans, not one
// shared span. requestMissingInfoApproval creates its own hitl.missing_info
// GATE span up front and patches it with the not-approved outcome on
// reject/timeout; runMissingInfo creates a fresh gen_ai.tool.missing_info
// EXECUTION span, only once an answer exists, one-shot with real output at
// creation — same shape every plain tool's run<ToolName> already has. Also
// holds handleMissingInfoReplyReceived/handleMissingInfoNoReply, the two
// non-step branches of what happens once a nudge settles (POST
// /api/owner-nudges/[correlationId]/answer is a thin trigger for the
// former).
//
// No escalations DB row — the correlation id, embedded in the Telegram
// nudge as `[ref:<correlationId>]` and echoed back via the owner's reply,
// is the only correlation key.

const missingInfoSchema = z.object({
  reason: z
    .string()
    .describe(
      "Brief paraphrase of the guest's question you could not answer (answerPropertyQuestion came back empty/insufficient). This is what the owner sees in the Telegram alert, so make it clear enough for them to answer without more context.",
    ),
});

export const missingInfo = tool({
  description:
    "Use when you could not find an answer to the guest's question anywhere in the property knowledge base. Alerts the owner to answer directly; once they do, their answer is added to the knowledge base for future guests.",
  inputSchema: missingInfoSchema,
});

// The event requestMissingInfoApproval below waits for and
// handleMissingInfoReplyReceived sends — shared as a constant so the two
// ends can't drift apart.
export const OWNER_NUDGE_ANSWERED_EVENT = "gca/owner-nudge.answered";

// Long enough for a human reply, but the guest still deserves a response
// within their own conversation rather than waiting forever.
const MISSING_INFO_REPLY_TIMEOUT = "24h";

// Embeds the owner's answer into the KB, then sends OWNER_NUDGE_ANSWERED_EVENT
// so a suspended step.waitForEvent (if still waiting) picks it up. Embed
// happens first, deliberately — by the time the event sends, the answer is
// already searchable. Throws if the KB write fails, before the event ever
// sends; a duplicate/late call is a safe no-op (inngest.send() gives no
// signal about whether a matching waiter still exists).
export async function handleMissingInfoReplyReceived(params: {
  correlationId: string;
  answer: string;
  // Used as this document's heading, matching the KB's `<heading>\n\n-
  // <content>` shape. Falls back to the bare answer when absent.
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
// yet.
export async function handleMissingInfoNoReply(params: { correlationId: string }): Promise<void> {
  const { correlationId } = params;
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for correlationId ${correlationId} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT}, falling back to the owner-notified response for this turn.`,
  );
}

// missing_info's "calls human" half: creates the hitl.missing_info GATE span
// first, sends the nudge, and suspends via step.waitForEvent until the owner
// replies (handleMissingInfoReplyReceived, via the API route) or times out.
// Patches its own span with the not-approved fallback on either non-approved
// exit — never on approval, since that output belongs to runMissingInfo's
// own separate execution span instead. HitlDecision<string>'s `payload` is
// the owner's real answer when `approved` is true.
//
// Two distinct not-approved messages: a failed nudge gets "couldn't reach
// the owner" (no point suspending on a reply never asked for); a
// sent-but-timed-out nudge still gets "owner has been notified" — true even
// though this specific answer never arrived in time.
export async function requestMissingInfoApproval(
  args: { reason: string },
  context: ToolContext,
): Promise<HitlDecision<string>> {
  const { conversationId, phone, step, correlationId, traceAnchor } = context;

  // Created FIRST so hitl.missing_info.nudge/.no_reply below nest as its
  // real children. This is the HITL gate span, not the execution span —
  // named hitl.missing_info (not gen_ai.tool.missing_info) so nesting the
  // approval wait under it doesn't misrepresent the wait as happening
  // inside the tool call. See run-agent-turn.ts's RULE comment.
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
  // See updateSpanIO's doc comment (tracing.ts) for why this flush is needed.
  await flushTracing();
  const hitlAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: hitlSpanId };

  // See recordMissingInfoTraceAnchor's doc comment (tracing.ts). Only
  // written when a real correlationId exists.
  if (correlationId) {
    await step.run("record-missing-info-trace-anchor", () =>
      recordMissingInfoTraceAnchor(correlationId, hitlAnchor),
    );
  }

  // Own step, distinct from "wait-for-owner-answer" below, so un-stepped
  // code can't re-send this Telegram nudge on replay.
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
    // Embedding already happened in handleMissingInfoReplyReceived — do not
    // re-embed here.
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
  // Not an approve/reject decision (approval-gate.ts's
  // braintrust.approval_decision doesn't apply) — a missing_info timeout
  // means "gave up waiting for the KB answer," not a rejected gate.
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
  const notApprovedOutput = {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
  await step.run("update-missing-info-trace-io", () =>
    updateSpanIO(hitlSpanId, { output: notApprovedOutput }),
  );
  return { approved: false, notApprovedOutput, hitlSpanId, hitlAnchor };
}

// missing_info's "tool call" half — only reached once
// requestMissingInfoApproval resolved `approved: true`, so the answer is
// already known. `args` isn't used, kept only to match every other tool's
// run<ToolName>(input, context) convention. One-shot, same shape as any
// plain tool's run<ToolName> — no pre-created span, unlike the GATE span
// above.
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
