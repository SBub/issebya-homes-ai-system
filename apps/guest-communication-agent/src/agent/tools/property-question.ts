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
// The inner withSpan below is a deliberate, narrow exception to this app's
// "tool files stay pure, no step/Inngest" rule (see run-tool.ts's/
// run-turn.ts's comments): it wraps only this file's own DB call, never
// touches `step`/Inngest, and carries none of the replay-safety hazard that
// rule exists to prevent. It nests automatically (via OTel's ambient
// context) inside runAnswerPropertyQuestion's own gen_ai.tool.* execution
// span below, giving fine-grained timing on the DB query specifically —
// separate from embed() and the rest of this function.
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

// The tool's real dispatch: this app's run<ToolName> convention (see
// wants-human.ts's runWantsHuman for the model this follows) — creates its
// own gen_ai.tool.answer_property_question execution span, called directly
// from run-tool.ts's runTool().
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
