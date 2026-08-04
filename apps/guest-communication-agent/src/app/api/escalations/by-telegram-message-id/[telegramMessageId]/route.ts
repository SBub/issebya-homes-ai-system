import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Lookup endpoint for the missing_info human-in-the-loop flow —
 * apps/telegram-router's webhook calls this on every reply, keyed on
 * Telegram's `reply_to_message.message_id`, to check whether that message
 * was one of this app's escalation nudges. Guarded by requireApiKey.
 *
 * A 404 is expected/routine, not an error: most replies in the owner's chat
 * have nothing to do with an escalation.
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
