import { type NextRequest, NextResponse } from "next/server";
import { listConversationsWithStuckSummary } from "@/lib/admin-conversations";
import { requireApiKey } from "@/lib/auth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Lists conversations for a follow-up admin recovery UI, newest-started
 * first, each annotated with a last-message preview and a `stuck` summary
 * so the UI can render a stuck badge/count with no per-row round trip — see
 * listConversationsWithStuckSummary's own doc comment for exactly what
 * "stuck" means and how it's computed.
 *
 * Query params: `?limit=` (default 50, capped at 200) — the underlying
 * queries are a couple of grouped round trips regardless of `limit`, not
 * N+1 per conversation, but an unbounded limit would still make each of
 * those round trips itself unbounded.
 *
 * Response: `{ conversations: ConversationListItem[] }` (see
 * admin-conversations.ts for the exact shape).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const rawLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const conversations = await listConversationsWithStuckSummary(limit);
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
