import { type NextRequest, NextResponse } from "next/server";
import { getConversationById, getConversationMessages } from "@/lib/admin-conversations";
import { requireApiKey } from "@/lib/auth";
import { listPendingOwnerDecisionsForConversation } from "@/lib/pending-owner-decisions";

// A message doesn't directly reference the pending_owner_decisions row it
// may be related to (there's no FK either direction) — rather than guess at
// pinning one exact message to one exact decision row, this route surfaces
// every pending_owner_decisions row for the conversation as its own list
// alongside the message history, each with its own `stuck` boolean computed
// the same way listStuckPendingOwnerDecisions does (relayed but not resolved
// for 5+ minutes). Simplicity over precision: an admin UI can show "this
// conversation has N pending decisions, M of them stuck" without this route
// trying to thread a decision row into a specific spot in the message list.
const STUCK_RELAYED_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Full chronological message history for one conversation, each message
 * including its delivery_status if set, plus a separate list of every
 * pending_owner_decisions row for the conversation (see this file's own
 * comment above for why decisions are a separate list rather than pinned to
 * one message).
 *
 * 404 if the conversation itself doesn't exist.
 *
 * Response: `{ conversation, messages, pendingDecisions }`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  try {
    const conversation = await getConversationById(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const [messages, pendingDecisions] = await Promise.all([
      getConversationMessages(id),
      listPendingOwnerDecisionsForConversation(id),
    ]);

    const now = Date.now();
    return NextResponse.json({
      conversation,
      messages,
      pendingDecisions: pendingDecisions.map((decision) => ({
        id: decision.id,
        correlationId: decision.correlationId,
        toolName: decision.toolName,
        reason: decision.reason,
        sentAt: decision.sentAt,
        relayedAt: decision.relayedAt,
        resolvedAt: decision.resolvedAt,
        resolution: decision.resolution,
        stuck:
          decision.relayedAt !== null &&
          decision.resolvedAt === null &&
          now - new Date(decision.relayedAt).getTime() > STUCK_RELAYED_THRESHOLD_MS,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
