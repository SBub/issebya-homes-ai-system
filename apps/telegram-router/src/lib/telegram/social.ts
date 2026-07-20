import { z } from "zod";

const generateResponseSchema = z.object({
  altText: z.string(),
  caption: z.string(),
  notionOk: z.boolean(),
  notionError: z.string().optional(),
});

export type GenerateResponse = z.infer<typeof generateResponseSchema>;

/**
 * Calls apps/social-media's plain logic API — this router owns all Telegram
 * I/O, that app owns none, so this is a normal server-to-server fetch, not
 * anything Telegram-shaped.
 */
export async function generateSocialPost(idea: string): Promise<GenerateResponse> {
  const baseUrl = process.env.SOCIAL_MEDIA_API_URL;
  const apiKey = process.env.SOCIAL_MEDIA_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("SOCIAL_MEDIA_API_URL/SOCIAL_MEDIA_API_KEY are not configured");
  }

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ idea }),
  });
  if (!res.ok) {
    throw new Error(`social-media /api/generate failed (${res.status}): ${await res.text()}`);
  }
  return generateResponseSchema.parse(await res.json());
}
