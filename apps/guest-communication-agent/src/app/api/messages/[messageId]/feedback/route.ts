import { Client } from "langsmith";
import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });

// The owner's own after-the-fact good/bad call, not an automated eval score.
const FEEDBACK_KEY = "human_approval";

interface MessageRow {
  langsmith_run_id: string | null;
}

/**
 * Records the owner's retrospective good/bad call on a past assistant reply
 * as LangSmith feedback attached to that turn's trace. Runs only after a
 * reply is already sent, from the CRM dashboard — never gates delivery.
 *
 * Request body: `{ score: 0 | 1, comment?: string }`. A blank/whitespace-only
 * comment is treated as absent and omitted from the LangSmith call.
 *
 * - 404 if no such message.
 * - 400 if langsmith_run_id is null (a guest message or proactive send never
 *   touches runAgentTurn, so has nothing to attach feedback to).
 * - 500 on a LangSmith API failure, `{ ok: true }` on success.
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
