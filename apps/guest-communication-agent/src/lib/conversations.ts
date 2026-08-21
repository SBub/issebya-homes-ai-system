import { createAdminClient } from "./supabase";
import { withSpan } from "./tracing";

export interface ActiveConversation {
  conversationId: string;
  /** True only on the insert branch — used to fire a one-time registerGuestContact() call on a guest's first message. */
  isNew: boolean;
}

/**
 * Finds the guest's currently-active conversation, or starts a new one.
 * `phone` is the bare (non-"whatsapp:"-prefixed) form — every caller has
 * already normalized it — and whatsapp_conversations.phone_number is stored
 * bare too, so this is a single, unqualified lookup.
 *
 * `.order(...).limit(1)` instead of bare `.maybeSingle()`, since a past
 * fragmentation bug can leave >1 "active" row for the same guest —
 * `.maybeSingle()` would error on that instead of degrading gracefully.
 */
export async function getOrCreateActiveConversation(phone: string): Promise<ActiveConversation> {
  return withSpan(
    "db.getOrCreateActiveConversation",
    { "db.table": "whatsapp_conversations" },
    async () => {
      const supabase = createAdminClient();

      const { data: existing, error: lookupError } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("phone_number", phone)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        throw new Error(
          `Failed to look up active whatsapp_conversation for ${phone}: ${lookupError.message}`,
        );
      }
      if (existing) {
        return { conversationId: existing.id, isNew: false };
      }

      const { data: created, error } = await supabase
        .from("whatsapp_conversations")
        .insert({ phone_number: phone })
        .select("id")
        .single();
      if (error || !created) {
        throw new Error(`Failed to create whatsapp_conversation for ${phone}: ${error?.message}`);
      }
      return { conversationId: created.id, isNew: true };
    },
  );
}

// `traceId` is omitted (not written as null) when absent — matches
// whatsapp_messages.trace_id's nullable convention (holds a real OTel trace
// id, see startTraceRoot in src/lib/tracing.ts). Returns the new row's id,
// passed through as RunAgentTurnConfig.triggerMessageId (the guest's real
// original message id, distinct from a tool's own paraphrase).
export async function recordMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  traceId?: string,
): Promise<string> {
  return withSpan(
    "db.recordMessage",
    { "db.table": "whatsapp_messages", "gca.conversation_id": conversationId, "gca.role": role },
    async () => {
      const supabase = createAdminClient();
      const insert: Record<string, unknown> = { conversation_id: conversationId, role, content };
      if (traceId !== undefined) {
        insert.trace_id = traceId;
      }
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .insert(insert)
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(
          `Failed to record ${role} message for conversation ${conversationId}: ${error?.message}`,
        );
      }
      return data.id;
    },
  );
}

// Only ever set on a role="assistant" row (see the delivery_status column's
// own migration comment for why a guest's own inbound row has no delivery
// status) — called by run-turn.ts's runGuestTurn right after
// sendGuestWhatsAppReply resolves, using recordMessage's own return value
// (the row id) as `messageId`, so it's a plain follow-up update rather than
// a change to recordMessage's insert shape itself.
export async function updateMessageDeliveryStatus(
  messageId: string,
  status: "sent" | "failed",
): Promise<void> {
  return withSpan(
    "db.updateMessageDeliveryStatus",
    { "db.table": "whatsapp_messages", "gca.message_id": messageId },
    async () => {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from("whatsapp_messages")
        .update({ delivery_status: status })
        .eq("id", messageId);
      if (error) {
        throw new Error(
          `Failed to update delivery_status for whatsapp_messages row ${messageId}: ${error.message}`,
        );
      }
    },
  );
}
