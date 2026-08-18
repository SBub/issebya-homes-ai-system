import type { Span } from "@opentelemetry/api";
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
//
// The withSpan below is a deliberate, narrow exception to run-turn.ts's "tool
// files stay pure, no step/span" rule (see that file's comment near `tools`):
// it wraps only this file's own DB call, never touches `step`/Inngest, and
// carries none of the replay-safety hazard that rule exists to prevent (see
// SELF_STEPPED_TOOLS's comment in run-turn.ts for that hazard). It nests
// automatically (via OTel's ambient context) inside the generic per-tool span
// run-turn.ts's dispatch loop already opens for this call, giving fine-grained
// timing on the DB query specifically — separate from embed() and the rest of
// this function. Moving it to run-turn.ts would mean moving the Supabase call
// itself there too (the span has to wrap the actual query), which would pull
// real business logic into the orchestrator — exactly backwards from what the
// rule is for. Kept here on purpose; do not treat this as license to add
// `step`/Inngest usage to this file.
export async function runAnswerPropertyQuestion(
  args: z.infer<typeof answerPropertyQuestionSchema>,
) {
  const { embedding } = await embed({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    value: args.query,
  });

  // Constructed lazily (not at module scope) so importing this file — e.g.
  // for its tool schema — doesn't require Supabase env vars to be set.
  const supabaseAnon = createClient();

  async function matchDocumentsForQuery(span: Span): Promise<string> {
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
  }

  return withSpan("db.matchDocuments", { "db.table": "documents" }, matchDocumentsForQuery);
}
