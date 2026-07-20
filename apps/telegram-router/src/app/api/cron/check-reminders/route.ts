import { type NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/telegram/auth";
import { getDueReminders, recordReminderSent } from "@/lib/telegram/notifications";
import { sendMessage } from "@/lib/telegram/telegram";

/**
 * Whatever real scheduler ends up existing (still an open deployment
 * question) should call this on a fixed interval — e.g. hourly is plenty,
 * since each reminder paces its own re-nag cadence via renotify_every.
 * Pulls due reminders from apps/notifications (pure logic, no Telegram
 * awareness) and sends each one itself, with a "✅ Done" button attached.
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const due = await getDueReminders();
  const results: Array<{ key: string; sent: boolean; error?: string }> = [];

  for (const reminder of due) {
    try {
      const sendResult = await sendMessage(`🔔 ${reminder.message}`, {
        text: "✅ Done",
        callbackData: `done:${reminder.key}`,
      });
      if (!sendResult.ok) {
        throw new Error(sendResult.error ?? "sendMessage failed");
      }
      if (sendResult.messageId) {
        await recordReminderSent(reminder.key, sendResult.messageId);
      }
      results.push({ key: reminder.key, sent: true });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[telegram-router] failed to send reminder ${reminder.key}:`, errorMessage);
      results.push({ key: reminder.key, sent: false, error: errorMessage });
    }
  }

  return NextResponse.json({ checked: due.length, results });
}
