import { DBOS } from "@dbos-inc/dbos-sdk";
import { embed, tool } from "ai";
import { z } from "zod";
import { openrouter } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase";
import type { ToolContext } from "./config";
import { performEscalation } from "./escalation-shared";

// ---------------------------------------------------------------------------
// This file is the single, consolidated home for the missing_info
// human-in-the-loop flow: the tool the model calls to ASK (runMissingInfo),
// and both branches of what happens once that question is settled — a reply
// arrives (handleMissingInfoReplyReceived) or one never does
// (handleMissingInfoNoReply). Deliberately NOT split across independent
// parallel mechanisms: POST /api/escalations/[id]/resolve
// (../../app/api/escalations/[id]/resolve/route.ts) is a thin trigger that
// calls handleMissingInfoReplyReceived below rather than containing its own
// embed/resume logic.
//
// The suspend/wait itself (waitForMissingInfoReply) is real DBOS:
// runAgentTurn (@/agent/run-turn.ts) runs inside a DBOS workflow (see
// @/agent/run-guest-turn.ts's runGuestTurn, registered as "runGuestTurn"),
// and runMissingInfo below — called from deep inside that workflow's own
// call stack — genuinely suspends via DBOS.recv() until
// handleMissingInfoReplyReceived calls DBOS.send() for this same workflow
// id, or the wait times out.
// ---------------------------------------------------------------------------

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

// The DBOS.send/recv topic this whole suspend/resume handshake runs over.
// Shared as one constant between waitForMissingInfoReply (recv, below) and
// handleMissingInfoReplyReceived (send, below) so the two sides can never
// drift apart.
const MISSING_INFO_REPLY_TOPIC = "missing_info_reply";

// How long a suspended missing_info workflow waits for the owner's Telegram
// reply before giving up and falling back to the "owner has been notified"
// response. 24h, same order of magnitude as
// harness-engineering/harness/runtime.ts's APPROVAL_TIMEOUT_S (86_400s) for
// the same reason: a human's reply is an unbounded-ish wait, not something
// to time out aggressively on — but the guest still deserves SOME reply
// within their own conversation rather than waiting forever on a workflow
// that may never resume.
const MISSING_INFO_REPLY_TIMEOUT_SECONDS = 24 * 60 * 60;

/**
 * Suspends the CURRENT DBOS workflow (via DBOS.recv, so this must only ever
 * be called from inside a runGuestTurn workflow's own call stack — see this
 * file's header comment) until handleMissingInfoReplyReceived below calls
 * DBOS.send(workflowId, answer, MISSING_INFO_REPLY_TOPIC) for this same
 * workflow, or MISSING_INFO_REPLY_TIMEOUT_SECONDS elapses first.
 *
 * Returns the owner's answer on a real reply. Returns null on a timeout —
 * DBOS.recv itself resolves null rather than throwing when its wait times
 * out — after first calling handleMissingInfoNoReply(escalationId) to
 * record that outcome (that function is the single, reused "reply never
 * came" handler; do not duplicate its logic here).
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
  // True only when DBOS.send was actually dispatched to a known, live
  // workflow id — NOT whether the guest was actually messaged. This
  // function runs synchronously inside POST /api/escalations/[id]/resolve's
  // HTTP request, long before the resumed workflow reaches a final reply —
  // whether the guest is ultimately messaged (and when) is entirely up to
  // that resumed workflow (@/agent/run-guest-turn.ts's runGuestTurn), which
  // this function has no visibility into. False covers both "no
  // workflow_id on this escalation to send to" and (implicitly, since
  // DBOS.send itself only fails on genuine infrastructure errors, which
  // propagate as a thrown exception rather than a quiet false) any case
  // this function could detect synchronously.
  resumed: boolean;
}

// REAL, working logic — this is the "reply received" branch: an owner's
// Telegram answer is now available for a missing_info escalation, so
// (1) embed it into the property knowledge base — same OpenRouter
// `openai/text-embedding-3-small` model and `documents` table
// search-property.ts's read path uses, so an answer embedded here lands in
// the same vector space a later guest question gets compared against — and
// (2) wake the suspended workflow (if any) that asked the question, via
// DBOS.send, so it can compose and deliver the real reply itself.
//
// Order matters and is deliberate, per the app owner: embed FIRST, then
// resume. By the time DBOS.send fires, the answer is already searchable, so
// if the resumed workflow's model needs to re-check the knowledge base for
// any reason, it finds the fresh content immediately.
//
// Throws (propagating the underlying error) if the KB embed/insert or the
// escalation resolution update itself fails — those are the durably
// important parts. Never throws over the DBOS.send below them; a missing or
// unaddressable workflow_id is only logged and reflected in `resumed`.
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

  // The escalation is now durably resolved regardless of what happens below
  // — waking the suspended workflow is the delivery mechanism on top of the
  // KB write and resolution bookkeeping above, not a condition for them.
  if (!workflowId) {
    console.error(
      `[missing-info] escalation ${escalationId} has no workflow_id — cannot resume a suspended workflow for it (it may predate this column, or performEscalation's insert ran outside a live DBOS workflow context). The knowledge base has been updated regardless; no proactive reply will be sent for this escalation.`,
    );
    return { resumed: false };
  }

  await DBOS.send(workflowId, answer, MISSING_INFO_REPLY_TOPIC);
  return { resumed: true };
}

// The "reply never came" branch — called by waitForMissingInfoReply above
// once its DBOS.recv wait times out. Currently just logs; a real
// timeout/expiry side effect (e.g. marking the escalation as expired, or
// nudging the owner again) is a reasonable future addition but out of scope
// here — the app owner's explicit scope limit for this change is the
// recv/send suspend-and-wait mechanism itself, not new timeout behavior.
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

  // DBOS.workflowID reads the id of the CURRENTLY RUNNING workflow — real
  // only when this call happens inside a runGuestTurn workflow's own call
  // stack (the live, real path). undefined otherwise (e.g. a direct,
  // non-workflow test call), in which case performEscalation simply omits
  // workflow_id from the insert rather than writing a meaningless value.
  const workflowId = DBOS.workflowID;

  // Step 1 — insert + Telegram nudge, same as every other escalation tool.
  const escalationId = await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "missing_info",
    triggerMessageId,
    workflowId,
  });

  // Step 2 — genuinely suspend and wait for the owner's reply (or time out).
  // No escalation id means the insert itself failed — nothing to wait on,
  // so skip straight to the same graceful fallback a timeout would produce.
  if (escalationId) {
    const answer = await waitForMissingInfoReply(escalationId);
    if (answer !== null) {
      // The embedding already happened on the resolve-route side, inside
      // handleMissingInfoReplyReceived, BEFORE DBOS.send delivered this
      // answer here — see that function's own doc comment. Do not re-embed
      // or otherwise re-run that logic from this call site; just hand the
      // answer back as this tool call's own result and let the model react
      // to it in the same turn.
      return { escalated: true, answer };
    }
    // Timed out — handleMissingInfoNoReply has already been called inside
    // waitForMissingInfoReply. Fall through to the same graceful response
    // below.
  }

  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
