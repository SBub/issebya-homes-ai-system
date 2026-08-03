import { type NextRequest, NextResponse } from "next/server";
import { handleMissingInfoReplyReceived } from "@/agent/tools/missing-info";
import { requireApiKey } from "@/lib/auth";
import { ensureDbosLaunched } from "@/lib/dbos";
import { createAdminClient } from "@/lib/supabase";

interface EscalationRow {
  id: string;
  reason_category: string | null;
  resolved_at: string | null;
  workflow_id: string | null;
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
 * and wake the suspended DBOS workflow that asked the question (if any) —
 * lives in @/agent/tools/missing-info.ts's handleMissingInfoReplyReceived,
 * which this route just calls. That function does the KB write and
 * escalation resolution BEFORE calling DBOS.send — see its own doc comment
 * for why that order matters. The resumed workflow (@/agent/run-guest-turn.ts's
 * runGuestTurn) composes and delivers the actual guest-facing reply
 * entirely on its own, well after this route's own HTTP response has
 * already been returned — this route has no visibility into that outcome.
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
 * - Otherwise: `{ ok: true, resumed: boolean }` — `resumed` is `true` only
 *   when DBOS.send was dispatched to a known, live workflow id; it does NOT
 *   mean the guest has been messaged yet (that happens later, inside the
 *   resumed workflow) — see handleMissingInfoReplyReceived's own doc
 *   comment for the full breakdown of when it's `false`.
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
    .select("id, reason_category, resolved_at, workflow_id")
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
    workflow_id: workflowId,
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
    await ensureDbosLaunched();
    const { resumed } = await handleMissingInfoReplyReceived({
      escalationId: id,
      answer,
      workflowId,
    });
    return NextResponse.json({ ok: true, resumed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
