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
 * Closes the human-in-the-loop for a missing_info escalation once the owner
 * has replied with the actual answer. A thin trigger: auth/parsing/status
 * mapping live here, actual KB-embed + resolve + DBOS.send logic lives in
 * handleMissingInfoReplyReceived.
 *
 * Request body: `{ answer: string }`.
 *
 * - 404 if no such escalation.
 * - 400 if `answer` is missing/blank, or reason_category isn't "missing_info"
 *   (the other two categories have no resolution flow here).
 * - 409 if already resolved — idempotency against a webhook retry.
 * - 500 if the KB embed/insert or escalation update itself fails.
 * - Otherwise `{ ok: true, resumed: boolean }` — see
 *   handleMissingInfoReplyReceived for what `resumed` means.
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
