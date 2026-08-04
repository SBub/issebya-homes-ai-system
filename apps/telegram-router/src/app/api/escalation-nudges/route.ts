import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/telegram/auth";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

/**
 * Inbound endpoint for apps/guest-communication-agent's own
 * performEscalation (see @/agent/tools/escalation-shared.ts) — this router
 * owns all Telegram I/O, so every escalation category pushes its owner
 * notification through here rather than GCA talking to Telegram itself.
 *
 * Guarded by requireApiKey (X-API-Key against TELEGRAM_ROUTER_API_KEY),
 * same shape as ../campaign-drafts/route.ts's own guard.
 *
 * Request body: `{ phone, reason, reasonCategory, conversationId,
 * workflowId? }`. There's no escalationId anymore — GCA's escalations table
 * is gone (see supabase/migrations/*_drop_escalations_table.sql). Instead,
 * for missing_info, GCA passes the current DBOS.workflowID as `workflowId`;
 * this route embeds it as a `[ref:<workflowId>]` tag at the very end of the
 * composed text (two newlines after the human-readable body) so a later
 * owner reply can be correlated back to that exact suspended workflow via
 * Telegram's own `reply_to_message.text` (see the webhook route's
 * handleEscalationReply) — no DB round-trip. wants_human never passes
 * workflowId (it's a one-way notification, no reply expected), so its text
 * never gets a ref tag.
 *
 * Composes a distinct message per reasonCategory, each with its own
 * emoji + short label prefix so the owner can tell them apart in Telegram
 * itself, without opening the CRM:
 *  - missing_info: "🔍 Missing info" — a plain message (no buttons — the
 *    owner is expected to reply with free text, not tap anything) inviting a
 *    reply, with the `[ref:...]` tag appended.
 *  - wants_human: "🙋 Wants human" — a plain one-way alert, no reply
 *    invitation, no ref tag.
 *
 * Sent via the same sendMessage/sendWithRetry every other Telegram send in
 * this router uses.
 *
 * Returns `{ ok: true }` on a successful send. Returns `{ ok: false, error }`
 * with 500 on a Telegram delivery failure (after the retry-once
 * sendWithRetry already gave it a second chance), same as campaign-drafts.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  const reason = body?.reason;
  const reasonCategory = body?.reasonCategory;
  const conversationId = body?.conversationId;
  const rawWorkflowId = body?.workflowId;
  const workflowId = typeof rawWorkflowId === "string" && rawWorkflowId ? rawWorkflowId : undefined;

  if (
    !phone ||
    typeof phone !== "string" ||
    !reason ||
    typeof reason !== "string" ||
    !reasonCategory ||
    typeof reasonCategory !== "string" ||
    !conversationId ||
    typeof conversationId !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing phone/reason/reasonCategory/conversationId in request body" },
      { status: 400 },
    );
  }

  let text: string;
  switch (reasonCategory) {
    case "missing_info":
      text = `🔍 Missing info\nGuest ${phone} asked: "${reason}"\n\nReply to this message with the answer — I'll send it to the guest and add it to the knowledge base.`;
      if (workflowId) {
        text += `\n\n[ref:${workflowId}]`;
      }
      break;
    case "wants_human":
      text = `🙋 Wants human\nGuest ${phone} needs you: ${reason}\n\nConversation: ${conversationId}`;
      break;
    default:
      text = `Guest ${phone} needs you: ${reason}\n\nConversation: ${conversationId}`;
  }

  const result = await sendWithRetry(() => sendMessage(text));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
