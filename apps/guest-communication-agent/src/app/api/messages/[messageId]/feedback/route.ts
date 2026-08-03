import { Client } from "langsmith";
import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

// Module-level client, same construction as @/agent/run-turn.ts's own
// langsmithClient — reused across requests rather than built per-call.
const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });

// Fixed feedback key for this v1, binary-only "flag after" feature — every
// piece of feedback recorded through this route is the owner's own
// after-the-fact good/bad call on a real reply, as opposed to e.g. an
// automated eval score, hence "human_approval" rather than something more
// generic like "quality".
const FEEDBACK_KEY = "human_approval";

interface MessageRow {
  langsmith_run_id: string | null;
}

/**
 * Records the owner's retrospective good/bad call on a specific past
 * assistant reply as real LangSmith feedback attached to that turn's own
 * trace — the "flag after" eval-feedback feature. Entirely decoupled from
 * delivery: this never gates/delays a reply, it only ever runs after one has
 * already been sent, on a message the owner is reviewing from the CRM
 * dashboard.
 *
 * Guarded by requireApiKey (X-API-Key against
 * GUEST_COMMUNICATION_AGENT_API_KEY), same as POST /api/send.
 *
 * Request body: `{ score: 0 | 1, comment?: string }` — score is still
 * required and binary-only. `comment` is this feature's free-text
 * enrichment (still tied to the one binary score, no per-dimension
 * classifiers): optional, but if present it must be a string (400
 * otherwise). A whitespace-only or empty comment is treated the same as no
 * comment at all — trimmed and omitted from the LangSmith call entirely,
 * matching this repo's "only include a field when it has a real value"
 * convention, rather than ever sending `comment: ""` through.
 *
 * Looks up whatsapp_messages by [messageId] for its own langsmith_run_id:
 *   - 404 (`{ error: "Message not found" }`) if no such message exists.
 *   - 400 (`{ error: "This message has no recorded trace to attach
 *     feedback to" }`) if langsmith_run_id is null — a guest's own message
 *     or a proactive/campaign send (POST /api/send), neither of which ever
 *     touches runAgentTurn() and so has nothing in LangSmith to attach
 *     feedback to (see whatsapp_messages.langsmith_run_id's own migration
 *     comment).
 *
 * Otherwise calls the LangSmith client's own createFeedback(runId, key,
 * { score }) — or { score, comment } when a real (non-empty, trimmed)
 * comment was given — 500 with the underlying error message on a LangSmith
 * API failure (a real external call that can fail), `{ ok: true }` (200) on
 * success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { messageId } = await params;

  const body = await request.json().catch(() => null);
  const score = body?.score;
  if (score !== 0 && score !== 1) {
    return NextResponse.json({ error: "score must be exactly 0 or 1" }, { status: 400 });
  }

  const rawComment = body?.comment;
  if (rawComment !== undefined && typeof rawComment !== "string") {
    return NextResponse.json({ error: "comment must be a string" }, { status: 400 });
  }
  const comment = typeof rawComment === "string" ? rawComment.trim() : "";

  const supabase = createAdminClient();
  const { data: message, error: selectError } = await supabase
    .from("whatsapp_messages")
    .select("langsmith_run_id")
    .eq("id", messageId)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const { langsmith_run_id: langsmithRunId } = message as MessageRow;
  if (!langsmithRunId) {
    return NextResponse.json(
      { error: "This message has no recorded trace to attach feedback to" },
      { status: 400 },
    );
  }

  try {
    await langsmithClient.createFeedback(
      langsmithRunId,
      FEEDBACK_KEY,
      comment ? { score, comment } : { score },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
