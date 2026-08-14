import { embed, tool } from "ai";
import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { openrouter } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase";

// Consolidated home for the missing_info tool's pure parts: the schema/
// declaration the model sees, the shared event/timeout constants, and both
// non-step branches of what happens once a nudge is settled — reply arrives
// (handleMissingInfoReplyReceived) or doesn't (handleMissingInfoNoReply).
// POST /api/owner-nudges/[correlationId]/answer is a thin trigger that calls
// handleMissingInfoReplyReceived, not its own logic.
//
// The real suspend/wait — sending the nudge (its own step), step.waitForEvent
// itself, and the no-reply-timeout fallback step — lives in run-turn.ts's
// private runMissingInfo, not here (see run-turn.ts's "tool files stay pure"
// rule near `tools`). This file has no step/span/Inngest-function import of
// its own; inngest.send below is a plain event send, not a step.
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

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to its own
// private runMissingInfo by name (tool name "missing_info", matching this
// literal key in run-turn.ts's `tools` ToolSet).
export const missingInfo = tool({
  description:
    "Use when you could not find an answer to the guest's question anywhere in the property knowledge base. Alerts the owner to answer directly; once they do, their answer is added to the knowledge base for future guests.",
  inputSchema: missingInfoSchema,
});

// The event run-turn.ts's runMissingInfo waits for and
// handleMissingInfoReplyReceived below sends — shared as a constant so the
// two ends can't drift apart.
export const OWNER_NUDGE_ANSWERED_EVENT = "gca/owner-nudge.answered";

// 24h — same order of magnitude as harness-engineering's APPROVAL_TIMEOUT_S:
// long enough for a human reply, but the guest still deserves a response
// within their own conversation rather than waiting forever. Exported for
// run-turn.ts's private runMissingInfo, which is the sole step.waitForEvent
// caller now.
export const MISSING_INFO_REPLY_TIMEOUT = "24h";

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
}): Promise<{ documentId: number; embeddingDimensions: number }> {
  const { correlationId, answer } = params;
  const supabase = createAdminClient();

  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: answer,
  });

  const { data: inserted, error: insertError } = await supabase
    .from("documents")
    .insert({
      content: answer,
      embedding: JSON.stringify(embedding),
      metadata: { source: "owner_nudge_answer" },
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? "documents insert returned no row");
  }

  await inngest.send({ name: OWNER_NUDGE_ANSWERED_EVENT, data: { correlationId, answer } });

  return { documentId: inserted.id as number, embeddingDimensions: embedding.length };
}

// Stub: only logs. No timeout/expiry side effect (re-nudging owner) exists
// yet. Called by run-turn.ts's private runMissingInfo (wrapped in its own
// step/span there, since this function itself must stay step/span-free) once
// its step.waitForEvent times out.
export async function handleMissingInfoNoReply(params: { correlationId: string }): Promise<void> {
  const { correlationId } = params;
  console.warn(
    `[missing-info] handleMissingInfoNoReply called for correlationId ${correlationId} — no reply arrived within ${MISSING_INFO_REPLY_TIMEOUT}, falling back to the owner-notified response for this turn.`,
  );
}
