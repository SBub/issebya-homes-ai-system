import { z } from "zod";

export const reminderSchema = z.object({
  key: z.string(),
  message: z.string(),
  dueAt: z.coerce.date(),
  lastMessageId: z.number().nullable(),
});

export type Reminder = z.infer<typeof reminderSchema>;
