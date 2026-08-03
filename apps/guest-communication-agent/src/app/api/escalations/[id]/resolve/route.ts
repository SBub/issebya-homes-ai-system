import { type NextRequest, NextResponse } from "next/server";
import { handleMissingInfoReplyReceived } from "@/agent/tools/missing-info";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

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
 * A thin trigger only: HTTP-layer concerns (auth, request-body parsing, the
 * escalation lookup and its 404/400/409 status mapping) live here, but the
 * actual "a missing_info reply has arrived" business logic — embed the
 * answer into the property knowledge base, mark the escalation resolved,
 * and (if possible) get the answer to the guest — lives in
 * @/agent/tools/missing-info.ts's handleMissingInfoReplyReceived, which this
 * route just calls. That file is the single, consolidated home for the
 * missing_info HITL flow (the ask-tool the model calls, the "reply
 * received" handler this route triggers, and the "reply never came" stub
 * handler) precisely so this flow isn't split across independent parallel
 * mechanisms — see that file's own top-of-file doc comment for the full
 * rationale.
 *
 * Request body: `{ answer: string }`.
 *
 * - 404 (`{ error: "Escalation not found" }`) if no such escalation.
 * - 400 (`{ error: "..." }`) if `answer` is missing/blank, or if the
 *   escalation's reason_category isn't "missing_info" — the other two
 *   categories have no resolution flow (see
 *   @/agent/tools/escalation-shared.ts's performEscalation), so there is
 *   nothing for this endpoint to do for them.
 * - 409 (`{ error: "Escalation already resolved" }`) if `resolved_at` is
 *   already set — idempotency against a Telegram webhook retry or a
 *   duplicate reply re-processing the same escalation (and, transitively,
 *   writing the same answer into the knowledge base twice).
 * - 500 (`{ error: "..." }`) if handleMissingInfoReplyReceived's durable
 *   part (the KB embed/insert or the escalation resolution update) itself
 *   fails — those are the parts that must not silently succeed.
 * - Otherwise: `{ ok: true, sentToGuest: boolean }` —  `sentToGuest` is
 *   `true` only when the guest-facing reply was actually attempted and
 *   delivered; see handleMissingInfoReplyReceived's own doc comment for the
 *   full breakdown of when it's `false`.
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

  try {
    const { sentToGuest } = await handleMissingInfoReplyReceived({
      escalationId: id,
      answer,
      conversationId,
      phone: phoneNumber,
      triggerMessageId,
    });
    return NextResponse.json({ ok: true, sentToGuest });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
