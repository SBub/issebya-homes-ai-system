import { DBOS, Error as DBOSErrors } from "@dbos-inc/dbos-sdk";
import { embed, tool } from "ai";
import { z } from "zod";
import { openrouter } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase";
import type { ToolContext } from "./config";
import { requestOwnerNudge } from "./owner-nudge";

// Consolidated home for the missing_info human-in-the-loop flow: the tool
// the model calls to ask (runMissingInfo), and both branches of what happens
// once it's settled — reply arrives (handleMissingInfoReplyReceived) or
// doesn't (handleMissingInfoNoReply). POST /api/owner-nudges/[workflowId]/answer
// is a thin trigger that calls handleMissingInfoReplyReceived, not its own logic.
//
// The suspend/wait is real DBOS: runMissingInfo runs inside a runGuestTurn
// workflow and genuinely suspends via DBOS.recv() until
// handleMissingInfoReplyReceived calls DBOS.send() for the same workflow id.
// There is no escalations DB row anymore — the workflow id itself, embedded
// in the Telegram nudge text as `[ref:<workflowId>]` and echoed back via the
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

// Shared topic constant so waitForMissingInfoReply (recv) and
// handleMissingInfoReplyReceived (send) can't drift apart.
const MISSING_INFO_REPLY_TOPIC = "missing_info_reply";

// 24h — same order of magnitude as harness-engineering's APPROVAL_TIMEOUT_S:
// long enough for a human reply, but the guest still deserves a response
// within their own conversation rather than waiting forever.
const MISSING_INFO_REPLY_TIMEOUT_SECONDS = 24 * 60 * 60;

/**
 * Suspends the current DBOS workflow via DBOS.recv until
 * handleMissingInfoReplyReceived sends on the same workflow id, or the
 * timeout elapses. Must only be called from inside a runGuestTurn workflow.
 * Returns null on timeout (DBOS.recv resolves null rather than throwing).
 * `workflowId` is only used for logging context here — the actual recv() is
 * scoped to the currently-running workflow implicitly, via DBOS.workflowID.
 */
export async function waitForMissingInfoReply(
  workflowId: string | undefined,
): Promise<string | null> {
  const answer = await DBOS.recv<string>(
    MISSING_INFO_REPLY_TOPIC,
    MISSING_INFO_REPLY_TIMEOUT_SECONDS,
  );
  if (answer === null || answer === undefined) {
    console.warn(
      `[missing-info] waitForMissingInfoReply timed out after ${MISSING_INFO_REPLY_TIMEOUT_SECONDS}s waiting for workflow ${workflowId ?? "unknown"}'s reply`,
    );
    await handleMissingInfoNoReply(workflowId);
    return null;
  }
  return answer;
}

export interface MissingInfoReplyResult {
  // True only when DBOS.send was dispatched without error — NOT whether the
  // guest was actually messaged; that happens later, inside the resumed
  // workflow, which this function has no visibility into. False when the
  // target workflow id doesn't exist (see the DBOSNonExistentWorkflowError
  // catch below) — e.g. a duplicate/late reply arriving after the workflow
  // already completed and was garbage-collected, or a malformed ref tag.
  resumed: boolean;
}

// "Reply received" branch: embeds the owner's answer into the KB (same
// embedding model/table property-question.ts reads from), then wakes the
// suspended workflow via DBOS.send. Embed happens first and deliberately —
// by the time DBOS.send fires the answer is already searchable.
//
// workflowId comes straight from the Telegram-embedded `[ref:...]` tag
// (extracted by telegram-router's webhook route) — no DB lookup involved.
//
// Throws if the KB write fails. A second DBOS.send for a workflow that
// already resumed (e.g. a duplicate reply or a retried webhook) is safe: per
// DBOS's own send/recv semantics, send() just persists another message to
// the destination workflow's durable inbox — it does not error, and nothing
// will ever consume that stray message since this workflow's one recv() call
// has already returned. The only real failure mode is a destination
// workflow id that doesn't exist at all (DBOSNonExistentWorkflowError, an FK
// violation), which is caught below and reflected as `resumed: false`
// instead of throwing.
export async function handleMissingInfoReplyReceived(params: {
  workflowId: string;
  answer: string;
}): Promise<MissingInfoReplyResult> {
  const { workflowId, answer } = params;
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

  try {
    await DBOS.send(workflowId, answer, MISSING_INFO_REPLY_TOPIC);
  } catch (err) {
    if (err instanceof DBOSErrors.DBOSNonExistentWorkflowError) {
      console.warn(
        `[missing-info] DBOS.send found no such workflow ${workflowId} — likely a duplicate/late reply after the workflow completed and was garbage-collected, or a malformed ref tag. The knowledge base has been updated regardless.`,
      );
      return { resumed: false };
    }
    throw err;
  }

  return { resumed: true };
}

// Stub: only logs. No timeout/expiry side effect (re-nudging owner) exists yet.
export async function handleMissingInfoNoReply(workflowId: string | undefined): Promise<void> {
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for workflow ${workflowId ?? "unknown"} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT_SECONDS}s, falling back to the owner-notified response for this turn.`,
  );
}

export async function runMissingInfo(
  args: z.infer<typeof missingInfoSchema>,
  context: ToolContext,
) {
  const { conversationId, phone } = context;

  // undefined outside a live runGuestTurn workflow (e.g. a direct test call);
  // requestOwnerNudge skips embedding a [ref:...] tag in that case.
  const workflowId = DBOS.workflowID;

  const nudged = await requestOwnerNudge({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "missing_info",
    workflowId,
  });

  // Nudge failed to send — skip straight to the same fallback a timeout
  // would produce; there's no point suspending if the owner was never told.
  if (nudged) {
    const answer = await waitForMissingInfoReply(workflowId);
    if (answer !== null) {
      // Embedding already happened in handleMissingInfoReplyReceived before
      // DBOS.send delivered this answer — do not re-embed here.
      return { escalated: true, answer };
    }
    // Timed out — handleMissingInfoNoReply already ran inside the wait above.
  }

  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
