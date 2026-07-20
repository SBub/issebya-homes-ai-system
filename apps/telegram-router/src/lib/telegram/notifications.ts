import { z } from "zod";

const reminderSchema = z.object({
  key: z.string(),
  message: z.string(),
  dueAt: z.coerce.date(),
  lastMessageId: z.number().nullable(),
});

export type Reminder = z.infer<typeof reminderSchema>;

const dueRemindersResponseSchema = z.object({ reminders: z.array(reminderSchema) });

function baseUrl(): string {
  const url = process.env.NOTIFICATIONS_API_URL;
  if (!url) {
    throw new Error("NOTIFICATIONS_API_URL is not configured");
  }
  return url;
}

function apiKey(): string {
  const key = process.env.NOTIFICATIONS_API_KEY;
  if (!key) {
    throw new Error("NOTIFICATIONS_API_KEY is not configured");
  }
  return key;
}

/** Calls apps/notifications' plain logic API — this router owns all Telegram I/O, that app owns none. */
export async function getDueReminders(): Promise<Reminder[]> {
  const res = await fetch(`${baseUrl()}/api/reminders/due`, {
    headers: { "X-API-Key": apiKey() },
  });
  if (!res.ok) {
    throw new Error(`notifications /api/reminders/due failed (${res.status}): ${await res.text()}`);
  }
  return dueRemindersResponseSchema.parse(await res.json()).reminders;
}

export async function acknowledgeReminder(key: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/reminders/${encodeURIComponent(key)}/ack`, {
    method: "POST",
    headers: { "X-API-Key": apiKey() },
  });
  if (!res.ok) {
    throw new Error(`notifications ack failed (${res.status}): ${await res.text()}`);
  }
}

export async function recordReminderSent(key: string, messageId: number): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/reminders/${encodeURIComponent(key)}/sent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey() },
    body: JSON.stringify({ messageId }),
  });
  if (!res.ok) {
    throw new Error(`notifications sent-record failed (${res.status}): ${await res.text()}`);
  }
}
