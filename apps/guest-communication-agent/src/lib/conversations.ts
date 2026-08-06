import { createAdminClient } from "./supabase";

export interface ActiveConversation {
  conversationId: string;
  /** True only on the insert branch — used to fire a one-time registerGuestContact() call on a guest's first message. */
  isNew: boolean;
}

/**
 * Finds the guest's currently-active conversation, or starts a new one.
 *
 * Checks both phone forms: Twilio's inbound webhook stores phone_number
 * "whatsapp:"-prefixed, but a bare (unprefixed) form has also been passed
 * in by past callers — an unqualified lookup missed the guest's real active
 * conversation and silently created a fragmented duplicate. A new row is
 * always inserted under the prefixed form so future inbound replies
 * (always prefixed) converge on it.
 *
 * `.order(...).limit(1)` instead of bare `.maybeSingle()`, since this
 * fragmentation bug can leave >1 "active" row for the same guest —
 * `.maybeSingle()` would error on that instead of degrading gracefully.
 */
export async function getOrCreateActiveConversation(phone: string): Promise<ActiveConversation> {
  const supabase = createAdminClient();

  const prefixedPhone = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
  const phoneForms = Array.from(new Set([phone, prefixedPhone]));

  const { data: existing } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .in("phone_number", phoneForms)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { conversationId: existing.id, isNew: false };
  }

  const { data: created, error } = await supabase
    .from("whatsapp_conversations")
    .insert({ phone_number: prefixedPhone })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Failed to create whatsapp_conversation for ${phone}: ${error?.message}`);
  }
  return { conversationId: created.id, isNew: true };
}

// `traceId` is omitted (not written as null) when absent — matches
// whatsapp_messages.langsmith_run_id's nullable convention. The column is
// still named langsmith_run_id (stale — it now holds a Braintrust trace id,
// see turnTraceContext in src/lib/tracing.ts) — renaming it is a separate
// future DB migration, out of scope here. Returns the new row's id, passed
// through as RunAgentTurnConfig.triggerMessageId (the guest's real original
// message id, distinct from a tool's own paraphrase).
export async function recordMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  traceId?: string,
): Promise<string> {
  const supabase = createAdminClient();
  const insert: Record<string, unknown> = { conversation_id: conversationId, role, content };
  if (traceId !== undefined) {
    insert.langsmith_run_id = traceId;
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
}
