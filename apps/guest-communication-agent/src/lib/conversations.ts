import { createAdminClient } from "./supabase";

// New — this webhook-orchestration layer didn't exist in the source app at
// all (it never had its own webhook; the graph was only ever invoked
// directly, e.g. from LangGraph Studio, with a conversationId already
// supplied by hand). Not a port, just enough plumbing for the webhook route
// to find/start a conversation and log both sides of the turn into the same
// whatsapp_conversations/whatsapp_messages tables the ported graph itself
// reads from (@/lib/db.ts).

export interface ActiveConversation {
  conversationId: string;
  /**
   * True only on the actual insert branch below — this is the one and only
   * "did a brand new conversation just start" signal in this codebase. The
   * webhook route uses it to fire a one-time registerGuestContact() call
   * (@/lib/crm.ts) on a guest's very first inbound message, without
   * re-registering them on every subsequent turn of an already-active
   * conversation.
   */
  isNew: boolean;
}

/** Finds the guest's currently-active conversation, or starts a new one. */
export async function getOrCreateActiveConversation(phone: string): Promise<ActiveConversation> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("phone_number", phone)
    .eq("status", "active")
    .maybeSingle();
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
}

export async function recordMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("whatsapp_messages")
    .insert({ conversation_id: conversationId, role, content });
  if (error) {
    throw new Error(
      `Failed to record ${role} message for conversation ${conversationId}: ${error.message}`,
    );
  }
}
