import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * New lookup endpoint for the missing_info human-in-the-loop flow —
 * apps/telegram-router's webhook calls this on every message that replies
 * to another message, keyed on Telegram's own
 * `reply_to_message.message_id` (the id of the message being replied to),
 * to check whether that message was actually one of this app's escalation
 * nudges — see @/agent/tools/escalation.ts's performEscalation, which stores that same
 * id as `telegram_message_id` once apps/telegram-router's
 * POST /api/escalation-nudges confirms the send.
 *
 * Guarded by requireApiKey (X-API-Key against
 * GUEST_COMMUNICATION_AGENT_API_KEY), same as every other route in this app.
 *
 * A 404 here is an expected, routine outcome, not an error: the webhook
 * receives every message in the owner's chat, including replies to
 * unrelated messages (a reminder's "Done" prompt, a campaign nudge, or just
 * a normal reply to someone else), so telegram-router must treat "not
 * found" as "this reply has nothing to do with an escalation, ignore
 * silently" rather than surfacing it as a failure.
 *
 * Response: `{ id, phone_number, reason, reason_category, resolved_at,
 * answer }` on a match. reason_category/resolved_at/answer are included
 * (unlike GET /api/escalations, which deliberately omits resolved_at —
 * see that route's own doc comment) because telegram-router's caller needs
 * all three to decide what to do next: confirm this is really a
 * missing_info escalation, and whether it's already been resolved (a
 * double reply or a Telegram webhook retry must not re-process it).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ telegramMessageId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { telegramMessageId } = await params;
  const parsedId = Number(telegramMessageId);
  if (!Number.isInteger(parsedId)) {
    return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("escalations")
    .select("id, phone_number, reason, reason_category, resolved_at, answer")
    .eq("telegram_message_id", parsedId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
