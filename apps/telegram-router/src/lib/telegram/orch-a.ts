import { z } from "zod";

const digestResponseSchema = z.object({
  text: z.string(),
});

export type DigestResponse = z.infer<typeof digestResponseSchema>;

function baseUrl(): string {
  const url = process.env.ORCH_A_API_URL;
  if (!url) {
    throw new Error("ORCH_A_API_URL is not configured");
  }
  return url;
}

function apiKey(): string {
  const key = process.env.ORCH_A_API_KEY;
  if (!key) {
    throw new Error("ORCH_A_API_KEY is not configured");
  }
  return key;
}

/**
 * Calls apps/orch-a's plain logic endpoint (`GET /digest`, a Mastra custom
 * API route — not under Mastra's own `/api` prefix, see that app's
 * src/mastra/routes/digest.ts for why) — this router owns all Telegram I/O,
 * Orch-A owns none. `text` is already fully-rendered Telegram-HTML, ready to
 * send as-is with `parse_mode: "HTML"`.
 */
export async function getDigest(): Promise<DigestResponse> {
  const res = await fetch(`${baseUrl()}/digest`, {
    headers: { "X-API-Key": apiKey() },
  });
  if (!res.ok) {
    throw new Error(`orch-a /digest failed (${res.status}): ${await res.text()}`);
  }
  return digestResponseSchema.parse(await res.json());
}
