/**
 * Ported from issebya-homes-website's
 * apps/guest-communication-agent/src/tools/search-property.ts (import path
 * updated: that repo's @issebya/shared/supabase -> this repo's inlined
 * ../lib/supabase). That file's own header comment (preserved in spirit
 * below) explains it was itself extracted from a now-deleted
 * `@issebya/agent-concierge` package in the source repo — reproduced here
 * for context, since this port has no direct access to that deleted
 * package's history:
 *
 * Extracted from the now-deleted `@issebya/agent-concierge` package
 * (originally `packages/agent-concierge/src/tools.ts`, `src/openrouter.ts`,
 * and `src/types.ts`). Two deliberate differences from that original
 * `createSearchPropertyTool`:
 *
 * 1. No `filter.type` parameter. The original exposed an optional
 *    `filter: { type: 'room_info' | 'pricing' | ... }` for narrowing
 *    `match_documents` results. This tool's `answerPropertyQuestion` wrapper
 *    (see ../graph/tools.ts) had already stopped exposing that parameter to
 *    the model before this extraction, after two confirmed bugs traced back
 *    to it: the model guessing a type that didn't match how a chunk was
 *    actually classified silently excluded real, relevant content a query
 *    would have found unfiltered. `match_documents`'s similarity threshold
 *    is already deliberately low/wide specifically so an unfiltered search
 *    finds the right content and the model sorts noise from the response —
 *    the type filter worked against that design rather than helping it.
 *
 * 2. No `chat_logs` write. The original logged every query/result to a
 *    `chat_logs` table. That table was dropped in the source repo (see its
 *    `drop_chat_logs` migration) alongside the package's removal, so that
 *    logging call — and the `sessionId` parameter that existed only to
 *    support it — was never ported here either.
 *
 * Everything else (the embedding call, the `match_documents` RPC call, the
 * result formatting) is unchanged from the original.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { createClient } from "../lib/supabase";

// OpenRouter exposes an OpenAI-compatible API, so this wraps it with
// @ai-sdk/openai's createOpenAI pointed at OpenRouter's base URL rather than
// using a dedicated OpenRouter SDK.
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

type DocumentMetadata = {
  source: string;
  section: string;
  type: string;
  topics: string[];
  content_hash: string;
};

type DocumentMatch = {
  id: number;
  content: string;
  metadata: DocumentMetadata;
  similarity: number;
  created_at: string;
};

const supabaseAnon = createClient();

/**
 * Search the property knowledge base for information about rooms, pricing,
 * check-in, location, house rules, local recommendations, and more.
 *
 * Embeds `query` via OpenRouter's `openai/text-embedding-3-small` model,
 * then searches pgvector via the `match_documents` RPC (unfiltered — see
 * the file-level comment for why the original `filter.type` param was
 * dropped) and returns the matched document contents joined together, or a
 * fallback string when nothing relevant is found.
 */
export async function searchProperty(query: string): Promise<string> {
  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: query,
  });

  const { data, error } = await supabaseAnon.rpc("match_documents", {
    query_embedding: JSON.stringify(embedding),
    match_count: 5,
    match_threshold: 0.3,
    filter: {},
  });

  if (error || !data?.length) {
    return "No relevant information found in the knowledge base.";
  }

  return (data as DocumentMatch[]).map((d) => d.content).join("\n\n");
}
