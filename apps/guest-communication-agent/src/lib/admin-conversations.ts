import { listStuckPendingOwnerDecisions } from "./pending-owner-decisions";
import { createAdminClient } from "./supabase";

// Read-side support for the src/app/api/admin/* routes (graceful-degradation
// branch): lets a follow-up admin UI list conversations, flag stuck ones,
// and drill into one conversation's full message history. Every query here
// throws on error, same as db.ts/conversations.ts — these routes' whole job
// IS the DB read/write, not incidental bookkeeping.
//
// "Stuck" covers all three failure classes this branch's task describes:
//   (a) any whatsapp_messages row with delivery_status = 'failed'
//   (b) a role='user' row with no later role='assistant' row, older than
//       ORPHANED_INBOUND_THRESHOLD_MS (an inbound message that never
//       reached/finished a guest turn)
//   (c) an unresolved pending_owner_decisions row whose decision/answer was
//       relayed at least 5 minutes ago and never consumed (see
//       pending-owner-decisions.ts's listStuckPendingOwnerDecisions)
// (b)'s threshold exists so an in-flight turn (a user message with no
// assistant reply yet, only seconds old) never shows as stuck.
const ORPHANED_INBOUND_THRESHOLD_MS = 10 * 60 * 1000;

export interface ConversationRow {
  id: string;
  phone: string;
  status: string;
  startedAt: string;
  closedAt: string | null;
}

export interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  deliveryStatus: "sent" | "failed" | null;
}

interface ConversationStuckSummary {
  any: boolean;
  failedDelivery: boolean;
  orphanedInbound: boolean;
  pendingDecision: boolean;
}

export interface ConversationListItem extends ConversationRow {
  lastMessage: MessageRow | null;
  stuck: ConversationStuckSummary;
}

function toConversationRow(data: Record<string, unknown>): ConversationRow {
  return {
    id: data.id as string,
    phone: data.phone_number as string,
    status: data.status as string,
    startedAt: data.started_at as string,
    closedAt: (data.closed_at as string | null) ?? null,
  };
}

function toMessageRow(data: Record<string, unknown>): MessageRow {
  return {
    id: data.id as string,
    role: data.role as "user" | "assistant",
    content: data.content as string,
    createdAt: data.created_at as string,
    deliveryStatus: (data.delivery_status as "sent" | "failed" | null) ?? null,
  };
}

// GET /api/admin/conversations' one query set: conversations, then their
// messages and any stuck pending decisions in two further grouped queries —
// not one per conversation, to keep this O(1) round trips regardless of how
// many conversations `limit` returns.
export async function listConversationsWithStuckSummary(
  limit: number,
): Promise<ConversationListItem[]> {
  const supabase = createAdminClient();

  const { data: conversations, error: conversationsError } = await supabase
    .from("whatsapp_conversations")
    .select("id, phone_number, status, started_at, closed_at")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (conversationsError) {
    throw new Error(`Failed to list whatsapp_conversations: ${conversationsError.message}`);
  }
  const conversationRows = (conversations ?? []).map(toConversationRow);
  if (conversationRows.length === 0) {
    return [];
  }
  const conversationIds = conversationRows.map((c) => c.id);

  // One row per conversation_id (last message + any-failed-delivery, both
  // computed in Postgres) instead of fetching every whatsapp_messages row —
  // full `content` included — for every listed conversation just to derive
  // that same one row per conversation in JS. See this RPC's own migration
  // (20260821110000_create_admin_conversation_message_summary.sql) for why
  // this scales with conversation count, not per-conversation message count.
  const { data: summaries, error: summariesError } = await supabase.rpc(
    "admin_conversation_message_summary",
    { conversation_ids: conversationIds },
  );
  if (summariesError) {
    throw new Error(
      `Failed to compute admin_conversation_message_summary: ${summariesError.message}`,
    );
  }

  const lastMessageByConversation = new Map<string, MessageRow>();
  const failedDeliveryConversations = new Set<string>();
  for (const row of (summaries ?? []) as Record<string, unknown>[]) {
    const conversationId = row.conversation_id as string;
    if (row.last_message_id !== null) {
      lastMessageByConversation.set(
        conversationId,
        toMessageRow({
          id: row.last_message_id,
          role: row.last_message_role,
          content: row.last_message_content,
          created_at: row.last_message_created_at,
          delivery_status: row.last_message_delivery_status,
        }),
      );
    }
    if (row.has_failed_delivery) {
      failedDeliveryConversations.add(conversationId);
    }
  }

  const stuckDecisions = await listStuckPendingOwnerDecisions();
  const pendingDecisionConversations = new Set(
    stuckDecisions.map((d) => d.conversationId).filter((id): id is string => id !== null),
  );

  const now = Date.now();
  return conversationRows.map((conversation) => {
    const lastMessage = lastMessageByConversation.get(conversation.id) ?? null;
    const orphanedInbound =
      lastMessage !== null &&
      lastMessage.role === "user" &&
      now - new Date(lastMessage.createdAt).getTime() > ORPHANED_INBOUND_THRESHOLD_MS;
    const failedDelivery = failedDeliveryConversations.has(conversation.id);
    const pendingDecision = pendingDecisionConversations.has(conversation.id);
    return {
      ...conversation,
      lastMessage,
      stuck: {
        any: failedDelivery || orphanedInbound || pendingDecision,
        failedDelivery,
        orphanedInbound,
        pendingDecision,
      },
    };
  });
}

export async function getConversationById(id: string): Promise<ConversationRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, phone_number, status, started_at, closed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up whatsapp_conversations row ${id}: ${error.message}`);
  }
  return data ? toConversationRow(data) : null;
}

// Full chronological history for one conversation — backs GET
// /api/admin/conversations/[id]/messages.
export async function getConversationMessages(conversationId: string): Promise<MessageRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, role, content, created_at, delivery_status")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(
      `Failed to list whatsapp_messages for conversation ${conversationId}: ${error.message}`,
    );
  }
  return (data ?? []).map(toMessageRow);
}

// Backs POST /api/admin/conversations/[id]/actions/retry-send — the most
// recent assistant reply that failed delivery, if any.
export async function getLastFailedDeliveryMessage(
  conversationId: string,
): Promise<MessageRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, role, content, created_at, delivery_status")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .eq("delivery_status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to look up last failed-delivery message for conversation ${conversationId}: ${error.message}`,
    );
  }
  return data ? toMessageRow(data) : null;
}

// Backs POST /api/admin/conversations/[id]/actions/retrigger-turn. "Orphaned"
// (a role='user' row with no later role='assistant' row) reduces to "the
// conversation's very last message is role='user'" — if it were 'assistant',
// every earlier user row already has a later assistant reply by
// construction. No age threshold here (unlike the list route's stuck
// summary): an operator calling this action explicitly already knows what
// they're retriggering.
export async function getLastOrphanedUserMessage(
  conversationId: string,
): Promise<MessageRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, role, content, created_at, delivery_status")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to look up last message for conversation ${conversationId}: ${error.message}`,
    );
  }
  if (data?.role !== "user") {
    return null;
  }
  return toMessageRow(data);
}
