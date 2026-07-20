import type pg from "pg";
import { type Reminder, reminderSchema } from "@/lib/notifications/types";

const DUE_QUERY = `
  select key, message, due_at, last_message_id
  from reminders
  where acknowledged_at is null
    and due_at <= now()
    and (
      last_sent_at is null
      or (renotify_every is not null and last_sent_at + renotify_every <= now())
    )
  order by due_at
`;

/**
 * A reminder is due to (re)send when: not yet acknowledged, past its due_at,
 * and either never sent yet or renotify_every has elapsed since last_sent_at
 * (renotify_every null means "send once, never repeat").
 */
export async function getDueReminders(pool: pg.Pool): Promise<Reminder[]> {
  const result = await pool.query(DUE_QUERY);
  return result.rows.map((row) =>
    reminderSchema.parse({
      key: row.key,
      message: row.message,
      dueAt: row.due_at,
      lastMessageId: row.last_message_id,
    }),
  );
}

/** Stops the reminder from ever (re)sending again. */
export async function acknowledgeReminder(pool: pg.Pool, key: string): Promise<boolean> {
  const result = await pool.query(
    "update reminders set acknowledged_at = now() where key = $1 and acknowledged_at is null",
    [key],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Records that a reminder was just sent, so re-nagging is paced by renotify_every. */
export async function recordSent(pool: pg.Pool, key: string, messageId: number): Promise<boolean> {
  const result = await pool.query(
    "update reminders set last_sent_at = now(), last_message_id = $2 where key = $1",
    [key, messageId],
  );
  return (result.rowCount ?? 0) > 0;
}
