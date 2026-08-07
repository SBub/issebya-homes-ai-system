import { embed, tool } from "ai";
import { z } from "zod";
import { openrouter } from "@/lib/openrouter";
import { markSpanFailed, withSpan } from "@/lib/tracing";
import { createClient } from "../../lib/supabase";

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

const answerPropertyQuestionSchema = z.object({
  query: z.string().describe("The search query based on what the guest is asking"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runAnswerPropertyQuestion below by name.
export const answerPropertyQuestion = tool({
  description:
    "Search the property knowledge base for information about rooms, pricing, check-in, location, house rules, local recommendations, and more.",
  inputSchema: answerPropertyQuestionSchema,
});

// Always searches unfiltered — a prior `filter.type` param was dropped after
// the model guessing a wrong type silently excluded relevant content.
export async function runAnswerPropertyQuestion(
  args: z.infer<typeof answerPropertyQuestionSchema>,
) {
  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: args.query,
  });

  return withSpan("db.matchDocuments", { "db.table": "documents" }, async (span) => {
    const { data, error } = await supabaseAnon.rpc("match_documents", {
      query_embedding: JSON.stringify(embedding),
      match_count: 5,
      match_threshold: 0.3,
      filter: {},
    });

    if (error) {
      // Previously collapsed into the same "no relevant information found"
      // string a genuine no-match produces — a DB/RPC outage and "nothing
      // matched" were indistinguishable. Still returns the same fallback
      // text (the guest/model shouldn't see a different answer either way),
      // just makes the real cause visible on the trace.
      markSpanFailed(span, error.message);
      return "No relevant information found in the knowledge base.";
    }
    if (!data?.length) {
      return "No relevant information found in the knowledge base.";
    }

    return (data as DocumentMatch[]).map((d) => d.content).join("\n\n");
  });
}
