import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { GUEST_TURN_REQUESTED_EVENT } from "@/agent/run-turn";
import { getConversationById, getLastOrphanedUserMessage } from "@/lib/admin-conversations";
import { requireApiKey } from "@/lib/auth";
import { inngest } from "@/lib/inngest";
import { normalizePhone } from "@/lib/phone";
import { startTraceRoot } from "@/lib/tracing";

/**
 * Re-fires GUEST_TURN_REQUESTED_EVENT for a conversation's most recent
 * orphaned inbound message (failure class 2: an inbound message that never
 * reached/finished a guest turn) — a fresh correlationId and a fresh trace
 * root, same shape the real webhook route (src/app/api/webhook/whatsapp/
 * route.ts) uses for its own enqueue call, since this is standing in for
 * that same enqueue having silently failed the first time.
 *
 * - 404 if the conversation doesn't exist.
 * - 400 if there's no orphaned inbound message to retrigger.
 * - Otherwise 200 with `{ ok: true, correlationId }` — the triggered
 *   function's own result isn't awaited here, same as the real webhook
 *   route: this only confirms the event was durably accepted by Inngest.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const orphanedMessage = await getLastOrphanedUserMessage(id);
    if (!orphanedMessage) {
      return NextResponse.json(
        { error: "No orphaned inbound message to retrigger for this conversation" },
        { status: 400 },
      );
    }

    const correlationId = crypto.randomUUID();
    const { anchor } = await startTraceRoot(
      "admin.retrigger_turn",
      {
        "gca.conversation_id": id,
      },
      async () => {},
    );

    await inngest.send({
      name: GUEST_TURN_REQUESTED_EVENT,
      data: {
        conversationId: id,
        // GuestTurnRequestedEventData.phone must already be normalized (no
        // "whatsapp:" prefix) — whatsapp_conversations.phone_number is
        // stored prefixed (see conversations.ts's getOrCreateActiveConversation),
        // so this route, unlike the real webhook route, has to normalize it
        // itself rather than inheriting an already-normalized value.
        phone: normalizePhone(conversation.phone),
        incomingMessage: orphanedMessage.content,
        triggerMessageId: orphanedMessage.id,
        correlationId,
        traceAnchor: anchor,
      },
    });

    return NextResponse.json({ ok: true, correlationId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
