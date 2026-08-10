import { embed, tool } from "ai";
import type { GetStepTools } from "inngest";
import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { openrouter } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase";
import { steppedSpan, type TraceAnchor } from "@/lib/tracing";
import type { ToolContext } from "./config";
import { requestOwnerNudge } from "./owner-nudge";

// Consolidated home for the missing_info human-in-the-loop flow: the tool
// the model calls to ask (runMissingInfo), and both branches of what happens
// once it's settled — reply arrives (handleMissingInfoReplyReceived) or
// doesn't (handleMissingInfoNoReply). POST /api/owner-nudges/[correlationId]/answer
// is a thin trigger that calls handleMissingInfoReplyReceived, not its own logic.
//
// The suspend/wait is real Inngest: runMissingInfo runs inside a
// run-guest-turn function and genuinely suspends via step.waitForEvent until
// handleMissingInfoReplyReceived sends OWNER_NUDGE_ANSWERED_EVENT carrying
// the same correlationId (or the timeout elapses). There is no escalations
// DB row anymore — the correlation id itself, embedded in the Telegram
// nudge text as `[ref:<correlationId>]` and echoed back via the owner's
// reply, is the only correlation key (see owner-nudge.ts and
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

// The event waitForMissingInfoReply waits for and handleMissingInfoReplyReceived
// sends — shared as a constant so the two ends can't drift apart.
export const OWNER_NUDGE_ANSWERED_EVENT = "gca/owner-nudge.answered";

// 24h — same order of magnitude as harness-engineering's APPROVAL_TIMEOUT_S:
// long enough for a human reply, but the guest still deserves a response
// within their own conversation rather than waiting forever.
const MISSING_INFO_REPLY_TIMEOUT = "24h";

/**
 * Suspends the current run via step.waitForEvent until
 * handleMissingInfoReplyReceived sends OWNER_NUDGE_ANSWERED_EVENT with a
 * matching correlationId, or the timeout elapses. Must only be called from
 * inside a runGuestTurn Inngest function. Returns null on timeout
 * (step.waitForEvent resolves null rather than throwing).
 */
export async function waitForMissingInfoReply(params: {
  step: GetStepTools<typeof inngest>;
  correlationId: string;
  traceAnchor: TraceAnchor;
}): Promise<string | null> {
  const { step, correlationId, traceAnchor } = params;

  const result = await step.waitForEvent("wait-for-owner-answer", {
    event: OWNER_NUDGE_ANSWERED_EVENT,
    match: "data.correlationId",
    timeout: MISSING_INFO_REPLY_TIMEOUT,
  });

  const answer = (result?.data.answer as string | undefined) ?? null;
  if (answer === null) {
    console.warn(
      `[missing-info] waitForMissingInfoReply timed out after ${MISSING_INFO_REPLY_TIMEOUT} waiting for correlationId ${correlationId}'s reply`,
    );
    // Own step — without it, a later replay of this run (e.g. a retry of
    // a subsequent step, same class of concern as owner-nudge-missing-info's
    // own step below) would re-run this un-stepped branch and duplicate-
    // emit this span every time, since step.waitForEvent's memoized
    // resolution doesn't memoize the code around it.
    await steppedSpan(
      step,
      "missing-info-no-reply",
      traceAnchor,
      "missing_info.no_reply",
      { "gca.timeout": MISSING_INFO_REPLY_TIMEOUT },
      () => handleMissingInfoNoReply({ correlationId }),
    );
    return null;
  }

  return answer;
}

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
// Throws if the KB write fails, before the event is ever sent. Unlike
// DBOS.send, which threw DBOSNonExistentWorkflowError for a target workflow
// that no longer existed (letting the old code tell a duplicate/late reply
// apart from a real resume), inngest.send() gives no equivalent signal:
// sending an event nobody's waiting on isn't an error, it's simply never
// consumed by anything. There's no honest way to report from here whether a
// matching waiter still existed, so this function no longer promises to
// know that — it resolves once the KB write has succeeded and the event has
// been accepted by Inngest, nothing more.
export async function handleMissingInfoReplyReceived(params: {
  correlationId: string;
  answer: string;
}): Promise<void> {
  const { correlationId, answer } = params;
  const supabase = createAdminClient();

  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: answer,
  });

  const { error: insertError } = await supabase.from("documents").insert({
    content: answer,
    embedding: JSON.stringify(embedding),
    metadata: { source: "owner_nudge_answer" },
  });
  if (insertError) {
    throw new Error(insertError.message);
  }

  await inngest.send({ name: OWNER_NUDGE_ANSWERED_EVENT, data: { correlationId, answer } });
}

// Stub: only logs. No timeout/expiry side effect (re-nudging owner) exists yet.
export async function handleMissingInfoNoReply(params: { correlationId: string }): Promise<void> {
  const { correlationId } = params;
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for correlationId ${correlationId} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT}, falling back to the owner-notified response for this turn.`,
  );
}

export async function runMissingInfo(
  args: z.infer<typeof missingInfoSchema>,
  context: ToolContext,
) {
  const { conversationId, phone, step, correlationId, traceAnchor } = context;

  // Its own step, distinct from "wait-for-owner-answer" below — sending the
  // nudge and waiting for the reply are two different kinds of operation.
  // Without this, a replay of this Inngest function (guaranteed once
  // step.waitForEvent below suspends and later resumes, since Inngest
  // replays the whole function body from the top) would re-send this real
  // Telegram nudge every single time, since un-stepped code isn't memoized
  // across replays the way step.waitForEvent itself is.
  const nudged = await steppedSpan(
    step,
    "owner-nudge-missing-info",
    traceAnchor,
    "owner_nudge.missing_info",
    { "gca.conversation_id": conversationId, "gca.phone": phone },
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
  if (nudged) {
    const answer = await waitForMissingInfoReply({
      step,
      correlationId: correlationId ?? "unknown",
      traceAnchor,
    });
    if (answer !== null) {
      // Embedding already happened in handleMissingInfoReplyReceived before
      // OWNER_NUDGE_ANSWERED_EVENT delivered this answer here — do not
      // re-embed here.
      return { escalated: true, answer };
    }
    // Timed out — handleMissingInfoNoReply already ran inside the wait above.
  }

  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
