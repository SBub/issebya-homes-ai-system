import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { resumeConversationWithAnswer } from "@/lib/resume-conversation";
import { createAdminClient } from "@/lib/supabase";

// Same OpenRouter-as-OpenAI-compatible-endpoint setup as
// ../../../../../tools/search-property.ts's own `openrouter` — duplicated
// rather than importing that module's client, since this route only needs
// the embedding call, not searchProperty's match_documents read path (and
// search-property.ts doesn't export its client). Model/settings below are
// deliberately identical to that file's embed() call for consistency: an
// answer embedded here must land in the same vector space a later guest
// question gets embedded into and compared against.
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

interface EscalationRow {
  id: string;
  reason_category: string | null;
  resolved_at: string | null;
  trigger_message_id: string | null;
  conversation_id: string;
  phone_number: string;
}

/**
 * Closes the human-in-the-loop loop for a missing_info escalation once the
 * owner has replied (via apps/telegram-router's webhook — see that repo's
 * reply-to-nudge branch) with the actual answer. Guarded by requireApiKey,
 * same as every other route in this app.
 *
 * No longer just a persist-and-embed step: for a missing_info escalation
 * with a `trigger_message_id`, this route now also drives the actual
 * guest-facing reply — replacing the old raw-relay responsibility that used
 * to sit in telegram-router's own sendGuestMessage call before it invoked
 * this endpoint. Once the owner's answer is embedded into the knowledge
 * base, GCA's real agent turn (@/agent/run-turn.ts) is re-run with the
 * guest's original question (not the model's paraphrased `reason`), so the
 * same agent/system-prompt/tools that handle a normal turn composes and
 * sends its own reply — see @/lib/resume-conversation.ts for the full
 * rationale and mechanics.
 *
 * Request body: `{ answer: string }`.
 *
 * - 404 (`{ error: "Escalation not found" }`) if no such escalation.
 * - 400 (`{ error: "..." }`) if `answer` is missing/blank, or if the
 *   escalation's reason_category isn't "missing_info" — the other two
 *   categories have no resolution flow (see @/agent/tools/escalation.ts's
 *   performEscalation), so there is nothing for this endpoint to do for
 *   them.
 * - 409 (`{ error: "Escalation already resolved" }`) if `resolved_at` is
 *   already set — idempotency against a Telegram webhook retry or a
 *   duplicate reply re-processing the same escalation (and, transitively,
 *   writing the same answer into the knowledge base twice).
 * - Otherwise: embeds `answer` via the same OpenRouter
 *   `openai/text-embedding-3-small` model search-property.ts's read path
 *   uses, inserts one row into `documents` (via createAdminClient — RLS
 *   only grants anon SELECT on that table, see
 *   supabase/migrations/20260720150001_create_documents_pgvector.sql, so
 *   this write needs the service-role client), then sets `resolved_at =
 *   now()` and `answer` on the escalation row. The KB write and this
 *   resolution bookkeeping are the durable, important parts — the escalation
 *   ends up marked resolved regardless of whether the proactive guest reply
 *   below succeeds.
 *
 *   If `trigger_message_id` is set, the referenced whatsapp_messages row's
 *   `content` (the guest's actual original message, not `reason`'s
 *   paraphrase of it) is looked up and passed to
 *   resumeConversationWithAnswer, which re-runs the agent turn and sends the
 *   guest their real answer. If `trigger_message_id` is null (an escalation
 *   from before this column existed, or a deterministic safety-net one that
 *   somehow lacks a clean trigger message), the re-invocation is skipped
 *   gracefully rather than failing the whole resolve call over a missing
 *   optional reference on old data.
 *
 *   Returns `{ ok: true, sentToGuest: boolean }` — `sentToGuest` is `true`
 *   only when the agent re-invocation actually ran and successfully
 *   delivered a reply; `false` covers both "skipped, no trigger message" and
 *   "attempted but failed" (Twilio send failure, bad agent output, etc.) —
 *   the caller (telegram-router) uses this to tell the owner whether the
 *   guest actually got a reply, not just whether the KB write succeeded.
 *
 * metadata on the inserted document is `{ source: "owner_escalation_answer",
 * escalation_id }` — `source` distinguishes these rows from whatever the
 * property's original seed content used, and `escalation_id` gives full
 * traceability back to the original guest question/conversation without
 * duplicating that data into `documents` itself.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const rawAnswer = body?.answer;
  const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
  if (!answer) {
    return NextResponse.json({ error: "Missing answer in request body" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: escalation, error: selectError } = await supabase
    .from("escalations")
    .select("id, reason_category, resolved_at, trigger_message_id, conversation_id, phone_number")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!escalation) {
    return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  }

  const {
    reason_category: reasonCategory,
    resolved_at: resolvedAt,
    trigger_message_id: triggerMessageId,
    conversation_id: conversationId,
    phone_number: phoneNumber,
  } = escalation as EscalationRow;

  if (reasonCategory !== "missing_info") {
    return NextResponse.json(
      { error: "Only missing_info escalations can be resolved through this endpoint" },
      { status: 400 },
    );
  }

  if (resolvedAt) {
    return NextResponse.json({ error: "Escalation already resolved" }, { status: 409 });
  }

  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: answer,
  });

  const { error: insertError } = await supabase.from("documents").insert({
    content: answer,
    embedding: JSON.stringify(embedding),
    metadata: { source: "owner_escalation_answer", escalation_id: id },
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("escalations")
    .update({ resolved_at: new Date().toISOString(), answer })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
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
        `[escalations] failed to load trigger_message_id ${triggerMessageId} for escalation ${id}, skipping guest re-invocation:`,
        triggerMessageError.message,
      );
    } else if (!triggerMessage) {
      console.error(
        `[escalations] trigger_message_id ${triggerMessageId} for escalation ${id} not found, skipping guest re-invocation`,
      );
    } else {
      const resumeResult = await resumeConversationWithAnswer({
        conversationId,
        phone: phoneNumber,
        triggerMessageContent: triggerMessage.content,
      });
      if (!resumeResult.ok) {
        console.error(
          `[escalations] resumeConversationWithAnswer failed for escalation ${id}:`,
          resumeResult.error,
        );
      }
      sentToGuest = resumeResult.ok;
    }
  }
  // trigger_message_id is null: an escalation from before this column
  // existed, or a deterministic safety-net one that somehow lacks a clean
  // trigger message — skip the re-invocation gracefully, sentToGuest stays
  // false, and the resolve call still succeeds.

  return NextResponse.json({ ok: true, sentToGuest });
}
