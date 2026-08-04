import { type NextRequest, NextResponse } from "next/server";
import { handleMissingInfoReplyReceived } from "@/agent/tools/missing-info";
import { requireApiKey } from "@/lib/auth";
import { ensureDbosLaunched } from "@/lib/dbos";

/**
 * Closes the human-in-the-loop for a missing_info escalation once the owner
 * replies on Telegram. A thin trigger: auth/parsing/status mapping live
 * here, actual KB-embed + DBOS.send logic lives in
 * handleMissingInfoReplyReceived.
 *
 * The dynamic segment is the suspended DBOS workflow's own DBOS.workflowID
 * — there is no escalations DB row anymore, so there's nothing to look up
 * by. apps/telegram-router's webhook route extracts this id straight out of
 * the owner's Telegram reply (the `[ref:<workflowId>]` tag embedded in the
 * original nudge text, see escalation-shared.ts/missing-info.ts) and calls
 * this route directly with it.
 *
 * Request body: `{ answer: string }`.
 *
 * - 400 if `answer` is missing/blank.
 * - 500 if the KB embed/insert fails, or DBOS.send fails for a reason other
 *   than the workflow simply not existing.
 * - A duplicate/late POST for the same workflow id is safe to retry: DBOS's
 *   send() is a silent no-op once nothing is waiting to recv() it (see
 *   handleMissingInfoReplyReceived's own comment), and a workflow id that no
 *   longer exists at all resolves to `resumed: false` instead of a 500 —
 *   there is no 409/already-resolved concept anymore since there's no row
 *   to hold that state.
 * - Otherwise `{ ok: true, resumed: boolean }` — see
 *   handleMissingInfoReplyReceived for what `resumed` means.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { workflowId } = await params;

  const body = await request.json().catch(() => null);
  const rawAnswer = body?.answer;
  const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
  if (!answer) {
    return NextResponse.json({ error: "Missing answer in request body" }, { status: 400 });
  }

  try {
    await ensureDbosLaunched();
    const { resumed } = await handleMissingInfoReplyReceived({ workflowId, answer });
    return NextResponse.json({ ok: true, resumed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
