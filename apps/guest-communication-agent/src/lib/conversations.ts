import { isValidTraceId } from "@opentelemetry/api";
import type { StoredTurnMessages } from "@/agent/turn-messages";
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

const UNIQUE_VIOLATION = "23505";

async function findAssistantMessageIdByTrace(traceId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("trace_id", traceId)
    .eq("role", "assistant")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to look up existing assistant message for trace ${traceId}: ${error?.message}`,
    );
  }
  return data.id;
}

// `trace_id` is written only for an OTel-valid `traceId` and omitted
// otherwise (see isValidTraceAnchor's landmine in src/lib/tracing.ts: the
// all-zero sentinel is shared by every untraced turn). Returns the new row's id,
// passed through as RunAgentTurnConfig.triggerMessageId (the guest's real
// original message id, distinct from a tool's own paraphrase).
//
// An assistant row with a valid trace id is unique per trace (partial unique
// index whatsapp_messages_assistant_trace_id_key), so an Inngest retry of
// record-reply whose earlier insert already landed returns that row's id
// instead of failing. Select-after-conflict rather than upsert: PostgREST's
// onConflict can't target a partial index.
export async function recordMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  traceId?: string,
  options?: { turnMessages?: StoredTurnMessages },
): Promise<string> {
  return withSpan(
    "db.recordMessage",
    { "db.table": "whatsapp_messages", "gca.conversation_id": conversationId, "gca.role": role },
    async () => {
      const supabase = createAdminClient();
      const insert: Record<string, unknown> = { conversation_id: conversationId, role, content };
      const dedupeTraceId = traceId !== undefined && isValidTraceId(traceId) ? traceId : undefined;
      if (traceId !== undefined && dedupeTraceId === undefined) {
        console.error(
          `[conversations] recordMessage got an invalid trace id "${traceId}"; storing null`,
        );
      }
      if (dedupeTraceId !== undefined) {
        insert.trace_id = dedupeTraceId;
      }
      if (options?.turnMessages !== undefined) {
        insert.turn_messages = options.turnMessages;
      }
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .insert(insert)
        .select("id")
        .single();
      if (error?.code === UNIQUE_VIOLATION && role === "assistant" && dedupeTraceId !== undefined) {
        return findAssistantMessageIdByTrace(dedupeTraceId);
      }
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
// status) — called by run-guest-turn.ts's runGuestTurn right after
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
