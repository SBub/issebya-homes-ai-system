import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

interface ConversationRow {
  id: string;
  status: "active" | "closed";
  started_at: string;
  closed_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  langsmith_run_id: string | null;
}

/**
 * Read endpoint for the CRM dashboard, proxied through CRM's own server-side
 * route. Guarded by requireApiKey, same as POST /api/send.
 *
 * Queries both the phone param as given and a "whatsapp:"-prefixed variant,
 * since Twilio stores phone_number prefixed while CRM's caller passes the
 * normalized/unprefixed form.
 *
 * Each message includes its own id (for a stable React key — created_at
 * alone can collide) and langsmith_run_id (null except for an assistant
 * reply; the dashboard uses its presence to show a feedback control).
 * Conversations ordered newest-first, each conversation's messages
 * oldest-first. `{ conversations: [] }` (200) when none exist.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "Missing phone query parameter" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: conversations, error: conversationsError } = await supabase
    .from("whatsapp_conversations")
    .select("id, status, started_at, closed_at")
    .in("phone_number", [phone, `whatsapp:${phone}`])
    .order("started_at", { ascending: false });

  if (conversationsError) {
    return NextResponse.json({ error: conversationsError.message }, { status: 500 });
  }

  const conversationRows = (conversations ?? []) as ConversationRow[];
  if (conversationRows.length === 0) {
    return NextResponse.json({ conversations: [] });
  }

  const conversationIds = conversationRows.map((conversation) => conversation.id);
  const { data: messages, error: messagesError } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, role, content, created_at, langsmith_run_id")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const messagesByConversation = new Map<string, MessageRow[]>();
  for (const message of (messages ?? []) as MessageRow[]) {
    const list = messagesByConversation.get(message.conversation_id) ?? [];
    list.push(message);
    messagesByConversation.set(message.conversation_id, list);
  }

  return NextResponse.json({
    conversations: conversationRows.map((conversation) => ({
      id: conversation.id,
      status: conversation.status,
      started_at: conversation.started_at,
      closed_at: conversation.closed_at,
      messages: (messagesByConversation.get(conversation.id) ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        langsmith_run_id: message.langsmith_run_id,
      })),
    })),
  });
}
