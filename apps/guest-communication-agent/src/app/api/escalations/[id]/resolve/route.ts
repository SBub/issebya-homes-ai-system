import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
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
}

/**
 * Closes the human-in-the-loop loop for a missing_info escalation once the
 * owner has replied (via apps/telegram-router's webhook — see that repo's
 * new reply-to-nudge branch) with the actual answer. Guarded by
 * requireApiKey, same as every other route in this app.
 *
 * Deliberately does NOT send the WhatsApp message itself — telegram-router
 * already did that via the existing sendGuestMessage/POST /api/send path
 * before ever calling this endpoint (see this app's own POST /api/send doc
 * comment for why that's the one guest-send path). This endpoint's only job
 * is to persist the outcome and write the new knowledge-base entry, so a
 * retry of just the KB-write side (if this call fails after the guest
 * already got their answer) doesn't risk a second WhatsApp message.
 *
 * Request body: `{ answer: string }`.
 *
 * - 404 (`{ error: "Escalation not found" }`) if no such escalation.
 * - 400 (`{ error: "..." }`) if `answer` is missing/blank, or if the
 *   escalation's reason_category isn't "missing_info" — the other three
 *   categories have no resolution flow (see @/graph/tools.ts's
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
 *   now()` and `answer` on the escalation row. Returns `{ ok: true }`.
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
    .select("id, reason_category, resolved_at")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!escalation) {
    return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  }

  const { reason_category: reasonCategory, resolved_at: resolvedAt } = escalation as EscalationRow;

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

  return NextResponse.json({ ok: true });
}
