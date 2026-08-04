import { embed } from "ai";
import { openrouter } from "@/lib/openrouter";
import { createClient } from "../lib/supabase";

type DocumentMetadata = {
  source: string;
  section: string;
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
 * Always searches unfiltered — a prior `filter.type` param was dropped after
 * the model guessing a wrong type silently excluded relevant content.
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
