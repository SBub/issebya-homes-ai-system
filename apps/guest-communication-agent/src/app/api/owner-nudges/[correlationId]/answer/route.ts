import { type NextRequest, NextResponse } from "next/server";
import { handleMissingInfoReplyReceived } from "@/agent/tools/missing-info";
import { requireApiKey } from "@/lib/auth";

/**
 * Closes the human-in-the-loop for a missing_info owner nudge once the owner
 * replies on Telegram. A thin trigger: auth/parsing/status mapping live
 * here, actual KB-embed + Inngest send logic lives in
 * handleMissingInfoReplyReceived.
 *
 * The dynamic segment is the suspended run-guest-turn Inngest function's own
 * correlation id — there is no escalations DB row anymore, so there's
 * nothing to look up by. apps/telegram-router's webhook route extracts this
 * id straight out of the owner's Telegram reply (the `[ref:<correlationId>]`
 * tag embedded in the original nudge text, see
 * owner-nudge.ts/missing-info.ts) and calls this route directly with it.
 *
 * Request body: `{ answer: string }`.
 *
 * - 400 if `answer` is missing/blank.
 * - 500 if the KB embed/insert fails, or the Inngest send itself errors.
 * - A duplicate/late POST for the same correlation id is safe to retry:
 *   sending an event nobody's waiting on isn't an error to Inngest, it's
 *   simply never consumed by anything — there's no way to honestly tell a
 *   late reply apart from a real resume anymore (see
 *   handleMissingInfoReplyReceived's own comment), so this route no longer
 *   reports a `resumed` flag. There's no 409/already-resolved concept
 *   either — there's no row to hold that state.
 * - Otherwise `{ ok: true }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ correlationId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { correlationId } = await params;

  const body = await request.json().catch(() => null);
  const rawAnswer = body?.answer;
  const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
  if (!answer) {
    return NextResponse.json({ error: "Missing answer in request body" }, { status: 400 });
  }

  try {
    await handleMissingInfoReplyReceived({ correlationId, answer });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
