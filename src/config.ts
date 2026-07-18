import { z } from "zod";

const envSchema = z.object({
  SUPABASE_DB_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  HEARTBEAT_STALE_AFTER_MINUTES: z.coerce.number().default(60 * 24 + 30),
  AVAILABILITY_STALE_AFTER_HOURS: z.coerce.number().default(24),
  FINANCE_STALE_AFTER_HOURS: z.coerce.number().default(24),
});

export type Settings = z.infer<typeof envSchema>;

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return envSchema.parse(env);
}
