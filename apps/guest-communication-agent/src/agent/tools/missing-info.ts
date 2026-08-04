import { DBOS } from "@dbos-inc/dbos-sdk";
import { embed, tool } from "ai";
import { z } from "zod";
import { openrouter } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase";
import type { ToolContext } from "./config";
import { performEscalation } from "./escalation-shared";

// Consolidated home for the missing_info human-in-the-loop flow: the tool
// the model calls to ask (runMissingInfo), and both branches of what happens
// once it's settled — reply arrives (handleMissingInfoReplyReceived) or
// doesn't (handleMissingInfoNoReply). POST /api/escalations/[id]/resolve is
// a thin trigger that calls handleMissingInfoReplyReceived, not its own logic.
//
// The suspend/wait is real DBOS: runMissingInfo runs inside a runGuestTurn
// workflow and genuinely suspends via DBOS.recv() until
// handleMissingInfoReplyReceived calls DBOS.send() for the same workflow id.

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
 */
export async function waitForMissingInfoReply(escalationId: string): Promise<string | null> {
  const answer = await DBOS.recv<string>(
    MISSING_INFO_REPLY_TOPIC,
    MISSING_INFO_REPLY_TIMEOUT_SECONDS,
  );
  if (answer === null || answer === undefined) {
    console.warn(
      `[missing-info] waitForMissingInfoReply timed out after ${MISSING_INFO_REPLY_TIMEOUT_SECONDS}s waiting for escalation ${escalationId}'s reply`,
    );
    await handleMissingInfoNoReply(escalationId);
    return null;
  }
  return answer;
}

export interface MissingInfoReplyResult {
  // True only when DBOS.send was dispatched to a known workflow id — NOT
  // whether the guest was actually messaged; that happens later, inside the
  // resumed workflow, which this function has no visibility into.
  resumed: boolean;
}

// "Reply received" branch: embeds the owner's answer into the KB (same
// embedding model/table search-property.ts reads from), then wakes the
// suspended workflow via DBOS.send. Embed happens first and deliberately —
// by the time DBOS.send fires the answer is already searchable.
//
// Throws if the KB write or escalation update fails. Never throws over a
// missing/unaddressable workflow_id — that's only logged and reflected in
// `resumed`.
export async function handleMissingInfoReplyReceived(params: {
  escalationId: string;
  answer: string;
  workflowId: string | null;
}): Promise<MissingInfoReplyResult> {
  const { escalationId, answer, workflowId } = params;
  const supabase = createAdminClient();

  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: answer,
  });

  const { error: insertError } = await supabase.from("documents").insert({
    content: answer,
    embedding: JSON.stringify(embedding),
    metadata: { source: "owner_escalation_answer", escalation_id: escalationId },
  });
  if (insertError) {
    throw new Error(insertError.message);
  }

  const { error: updateError } = await supabase
    .from("escalations")
    .update({ resolved_at: new Date().toISOString(), answer })
    .eq("id", escalationId);
  if (updateError) {
    throw new Error(updateError.message);
  }

  if (!workflowId) {
    console.error(
      `[missing-info] escalation ${escalationId} has no workflow_id — cannot resume a suspended workflow for it (it may predate this column, or performEscalation's insert ran outside a live DBOS workflow context). The knowledge base has been updated regardless; no proactive reply will be sent for this escalation.`,
    );
    return { resumed: false };
  }

  await DBOS.send(workflowId, answer, MISSING_INFO_REPLY_TOPIC);
  return { resumed: true };
}

// Stub: only logs. No timeout/expiry side effect (marking escalation
// expired, re-nudging owner) exists yet.
export async function handleMissingInfoNoReply(escalationId: string): Promise<void> {
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for escalation ${escalationId} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT_SECONDS}s, falling back to the owner-notified response for this turn.`,
  );
}

export async function runMissingInfo(
  args: z.infer<typeof missingInfoSchema>,
  context: ToolContext,
) {
  const { conversationId, phone, triggerMessageId } = context;

  // undefined outside a live runGuestTurn workflow (e.g. a direct test call);
  // performEscalation omits workflow_id from the insert in that case.
  const workflowId = DBOS.workflowID;

  const escalationId = await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "missing_info",
    triggerMessageId,
    workflowId,
  });

  // No escalation id means the insert failed — skip straight to the same
  // fallback a timeout would produce.
  if (escalationId) {
    const answer = await waitForMissingInfoReply(escalationId);
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
