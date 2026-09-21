import type { Span } from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";
import { embed, tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { openrouter } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase";
import { markSpanFailed, steppedSpan, withSpan } from "@/lib/tracing";
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

  // Constructed lazily (not at module scope) so importing this file, e.g.
  // for its tool schema, doesn't require Supabase env vars to be set.
  //
  // LANDMINE: must be the service-role client. In the hosted project the
  // anon role has no privileges on `documents` (only local Supabase grants
  // them by default), so an anon client makes every production lookup fail
  // with 42501 while the fallback text below makes it look like an empty
  // KB. Grants history: supabase/migrations/20260828120000_grant_service_role_all_public.sql.
  const supabase = createAdminClient();

  async function matchDocumentsForQuery(span: Span): Promise<string> {
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: JSON.stringify(embedding),
      match_count: 5,
      match_threshold: 0.3,
      filter: {},
    });

    if (error) {
      // Same fallback text as a genuine no-match: the system prompt's rule
      // 1 keys on this phrasing to route to missing_info. The span
      // attribute, log line and Sentry event are what tell the two apart.
      const dbError = new Error(`match_documents failed (${error.code}): ${error.message}`);
      span.setAttribute("db.error_code", error.code);
      markSpanFailed(span, dbError);
      console.error("[answer_property_question] match_documents RPC failed:", {
        code: error.code,
        message: error.message,
      });
      Sentry.captureException(dbError, {
        tags: { tool: "answer_property_question", "db.error_code": error.code },
      });
      return "No relevant information found in the knowledge base.";
    }
    const matches = (data ?? []) as DocumentMatch[];
    span.setAttribute("db.match_count", matches.length);
    if (matches.length === 0) {
      return "No relevant information found in the knowledge base.";
    }
    span.setAttribute("db.top_similarity", matches[0].similarity);

    return matches.map((d) => d.content).join("\n\n");
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
