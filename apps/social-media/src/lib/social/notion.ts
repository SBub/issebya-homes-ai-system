import type { SocialPost } from "./generate.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionSyncResult {
  ok: boolean;
  error?: string;
}

/**
 * Notion sync is optional and best-effort, same contract as
 * apps/finance's notion.ts: no-ops (ok: true, no network call) when
 * NOTION_API_KEY/NOTION_DATABASE_ID aren't set.
 */
export function notionConfigured(): boolean {
  return Boolean(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID);
}

function notionHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * Maps to the real "Social Media Posts" Notion database (id in
 * NOTION_DATABASE_ID): "Name" (title, Notion's default), "Alt text" and
 * "Caption" (both rich_text) — confirmed against the actual schema, not a
 * placeholder.
 */
export function postToNotionProperties(idea: string, post: SocialPost): Record<string, unknown> {
  return {
    Name: { title: [{ text: { content: idea } }] },
    "Alt text": { rich_text: [{ text: { content: post.altText } }] },
    Caption: { rich_text: [{ text: { content: post.caption } }] },
  };
}

/**
 * Creates a new Notion page per generated post. Unlike apps/finance's
 * upsert-by-booking-ID sync, every /social submission is a distinct new idea
 * with no natural dedup key, so this always creates rather than checking for
 * an existing page first.
 */
export async function createSocialPost(idea: string, post: SocialPost): Promise<NotionSyncResult> {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${NOTION_API}/pages`, {
      method: "POST",
      headers: notionHeaders(apiKey),
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: postToNotionProperties(idea, post),
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion create failed (${res.status}): ${await res.text()}`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
