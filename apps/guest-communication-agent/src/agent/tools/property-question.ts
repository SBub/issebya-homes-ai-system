import type { Span } from "@opentelemetry/api";
import { embed, tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { openrouter } from "@/lib/openrouter";
import { markSpanFailed, steppedSpan, withSpan } from "@/lib/tracing";
import { createClient } from "../../lib/supabase";
import type { ToolContext } from "./config";

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

// Schema-only — run-tool.ts dispatches to runAnswerPropertyQuestion below by
// name.
export const answerPropertyQuestion = tool({
  description:
    "Search the property knowledge base for information about rooms, pricing, check-in, location, house rules, local recommendations, and more.",
  inputSchema: answerPropertyQuestionSchema,
});

// Always searches unfiltered — a prior `filter.type` param was dropped after
// the model guessing a wrong type silently excluded relevant content.
//
// The inner withSpan is a plain OTel span, no step/Inngest — nests
// automatically under runAnswerPropertyQuestion's own execution span,
// giving fine-grained timing on the DB query alone.
async function queryPropertyKnowledgeBase(args: z.infer<typeof answerPropertyQuestionSchema>) {
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
      // Same fallback text as a genuine no-match, so the guest/model sees no
      // difference — markSpanFailed just makes the real cause visible on
      // the trace instead of indistinguishable from "nothing matched".
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

export async function runAnswerPropertyQuestion(
  args: z.infer<typeof answerPropertyQuestionSchema>,
  context: ToolContext,
) {
  return steppedSpan(
    context.step,
    "tool-answer_property_question",
    context.traceAnchor,
    "gen_ai.tool.answer_property_question",
    { "gen_ai.tool.name": "answer_property_question", "gen_ai.operation.name": "execute_tool" },
    (span) => dispatchToolExecution(span, args, () => queryPropertyKnowledgeBase(args)),
  );
}
