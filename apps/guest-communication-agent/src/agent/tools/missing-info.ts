import { embed, tool } from "ai";
import { z } from "zod";
import { openrouter } from "@/lib/openrouter";
import { resumeConversationWithAnswer } from "@/lib/resume-conversation";
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
// (../../app/api/escalations/[id]/resolve/route.ts) is now a thin trigger
// that calls handleMissingInfoReplyReceived below rather than containing its
// own embed/resume logic. When real durable suspend/resume (DBOS or
// similar) gets plugged in later, only waitForMissingInfoReply's insides
// should need to change — the "what happens when the reply comes in" and
// "what happens when it doesn't" logic already lives here, centrally.
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

// STUB — see waitForMissingInfoReply's own doc comment for what "real" would
// look like. Distinguishes the stub's expected failure from a genuine bug
// so runMissingInfo's catch below only swallows the case it means to.
export class HitlNotImplementedError extends Error {
  constructor(escalationId: string) {
    super(
      `waitForMissingInfoReply STUB: no durable suspend/wait mechanism exists yet to wait in-loop for escalation ${escalationId}'s reply. The real, currently-working path is the owner replying on Telegram, which drives POST /api/escalations/${escalationId}/resolve -> handleMissingInfoReplyReceived below.`,
    );
    this.name = "HitlNotImplementedError";
  }
}

// STUB — represents "suspend this tool call here until the owner's Telegram
// reply arrives, then resume with it as the call's return value." There is
// no durable suspend/wait mechanism yet (no DBOS or equivalent), so this
// cannot actually wait today — it throws immediately rather than silently
// fabricating an answer. A real implementation would durably park here and,
// once the reply lands, dispatch to handleMissingInfoReplyReceived below (or
// to handleMissingInfoNoReply if a timeout fires first) and resume with
// whichever result comes back — the same two branches POST
// /api/escalations/[id]/resolve already drives today via the separate,
// real (non-in-loop) mechanism.
export async function waitForMissingInfoReply(escalationId: string): Promise<string> {
  console.warn(
    `[missing-info] waitForMissingInfoReply STUB called for escalation ${escalationId} — no real suspend/wait exists yet, throwing HitlNotImplementedError.`,
  );
  throw new HitlNotImplementedError(escalationId);
}

export interface MissingInfoReplyResult {
  // True only when a guest-facing reply was actually attempted AND
  // delivered — false covers both "not attempted" (no triggerMessageId) and
  // "attempted but failed" (Twilio send failure, bad agent output, etc.).
  sentToGuest: boolean;
}

// REAL, working logic — moved here from POST /api/escalations/[id]/resolve
// (which now just calls this), not a stub. This is the "reply received"
// branch: an owner's Telegram answer is now available for a missing_info
// escalation, so (1) embed it into the property knowledge base — same
// OpenRouter `openai/text-embedding-3-small` model and `documents` table
// search-property.ts's read path uses, so an answer embedded here lands in
// the same vector space a later guest question gets compared against — and
// (2) if this escalation has a trigger_message_id, get the answer to the
// guest by re-invoking the full agent turn with their original question
// replayed (resumeConversationWithAnswer, @/lib/resume-conversation.ts) —
// today's only real way to deliver it, since there is no live turn left to
// resume in-place.
//
// triggerMessageId is passed explicitly (not looked up here) so callers
// that must NOT trigger a re-invocation can simply omit it — see
// runMissingInfo's step 3 below, which calls this same function but with
// triggerMessageId: null deliberately, since that call site is still inside
// the very turn that asked the question in the first place; re-invoking a
// second turn there would be reentrant and wrong. That is a call-site
// choice, not a special case in this function — this function always
// attempts the resume if given a triggerMessageId, and only ever skips it
// when the caller withholds one.
//
// Throws (propagating the underlying error) if the KB embed/insert or the
// escalation resolution update itself fails — those are the durably
// important parts. Never throws over the best-effort guest reply below
// them; a failure there is only logged and reflected in sentToGuest.
export async function handleMissingInfoReplyReceived(params: {
  escalationId: string;
  answer: string;
  conversationId: string;
  phone: string;
  triggerMessageId: string | null;
}): Promise<MissingInfoReplyResult> {
  const { escalationId, answer, conversationId, phone, triggerMessageId } = params;
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
  // — the proactive guest reply is best-effort on top of the KB write and
  // resolution bookkeeping above, not a condition for them.
  let sentToGuest = false;

  if (triggerMessageId) {
    const { data: triggerMessage, error: triggerMessageError } = await supabase
      .from("whatsapp_messages")
      .select("content")
      .eq("id", triggerMessageId)
      .maybeSingle();

    if (triggerMessageError) {
      console.error(
        `[missing-info] failed to load trigger_message_id ${triggerMessageId} for escalation ${escalationId}, skipping guest re-invocation:`,
        triggerMessageError.message,
      );
    } else if (!triggerMessage) {
      console.error(
        `[missing-info] trigger_message_id ${triggerMessageId} for escalation ${escalationId} not found, skipping guest re-invocation`,
      );
    } else {
      const resumeResult = await resumeConversationWithAnswer({
        conversationId,
        phone,
        triggerMessageContent: triggerMessage.content,
      });
      if (!resumeResult.ok) {
        console.error(
          `[missing-info] resumeConversationWithAnswer failed for escalation ${escalationId}:`,
          resumeResult.error,
        );
      }
      sentToGuest = resumeResult.ok;
    }
  }
  // triggerMessageId is null: either this escalation genuinely has none (an
  // old row, or a deterministic safety-net one), or the caller deliberately
  // withheld it (see this function's own doc comment) — either way, skip
  // the re-invocation gracefully rather than failing the whole call.

  return { sentToGuest };
}

// STUB / TODO — the "reply never came" branch. Nothing calls this yet:
// there is no timeout/expiry mechanism for an unresolved escalation today,
// and there cannot be one until waitForMissingInfoReply above is backed by
// a real durable suspend to time out in the first place. This function
// exists now, named and in place, purely so that wiring in a real timeout
// later is a matter of filling this in and calling it from that suspend
// mechanism's own timeout branch — not inventing a new branch from scratch.
export async function handleMissingInfoNoReply(escalationId: string): Promise<void> {
  console.warn(
    `[missing-info] handleMissingInfoNoReply STUB called for escalation ${escalationId} — no real timeout/expiry handling exists yet (TODO once real persistence is wired in).`,
  );
}

export async function runMissingInfo(
  args: z.infer<typeof missingInfoSchema>,
  context: ToolContext,
) {
  const { conversationId, phone, triggerMessageId } = context;

  // Step 1 — real, unchanged: ask for the reply. Same escalations insert +
  // Telegram nudge every escalation tool uses.
  const escalationId = await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "missing_info",
    triggerMessageId,
  });

  // Steps 2 (wait) and 3 (embed once a reply exists) are stub scaffolding
  // for a future unified in-loop HITL flow. waitForMissingInfoReply always
  // throws HitlNotImplementedError today (no real suspend exists), so step
  // 3 below is unreachable/dead code for now — that's expected. The catch
  // falls back to today's real, already-working completion behavior (the
  // same "owner has been notified" acknowledgement every escalation tool
  // returns) rather than letting this stub's expected failure break the
  // live turn. Once waitForMissingInfoReply is real, this fallback goes
  // away and step 3 starts running for real.
  if (escalationId) {
    try {
      const answer = await waitForMissingInfoReply(escalationId);
      // Step 3: reuses handleMissingInfoReplyReceived above — the same
      // single embed+resume implementation POST
      // /api/escalations/[id]/resolve's thin trigger calls — rather than a
      // second, divergent embedding implementation. triggerMessageId is
      // deliberately NOT forwarded: this call site is still inside the very
      // runAgentTurn that asked the question, so re-invoking a brand-new
      // turn via resumeConversationWithAnswer here would be reentrant and
      // wrong. Once a real suspend/resume exists, the answer instead flows
      // back as THIS tool call's own return value below, continuing the
      // same turn rather than starting a second one.
      const { sentToGuest } = await handleMissingInfoReplyReceived({
        escalationId,
        answer,
        conversationId,
        phone,
        triggerMessageId: null,
      });
      return { escalated: true, answer, sentToGuest };
    } catch (err) {
      if (!(err instanceof HitlNotImplementedError)) {
        throw err;
      }
      console.warn(
        `[missing-info] ${err.message} — falling back to the real owner-notified response.`,
      );
    }
  }

  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
