import { tool } from "ai";
import { z } from "zod";
import { searchProperty } from "../../tools/search-property";

const answerPropertyQuestionSchema = z.object({
  query: z.string().describe("The search query based on what the guest is asking"),
});

// Schema-only declaration — no `execute`. Dispatch is manual: run-turn.ts's
// own tool-call step looks up runAnswerPropertyQuestion below by tool name
// and calls it directly, rather than delegating to AI SDK's internal
// per-tool execution. No per-turn context needed, so this stays a single
// module-level instance — see pricing.ts's own comment for why that's safe.
export const answerPropertyQuestion = tool({
  description:
    "Search the property knowledge base for information about rooms, pricing, check-in, location, house rules, local recommendations, and more.",
  inputSchema: answerPropertyQuestionSchema,
});

export async function runAnswerPropertyQuestion(
  args: z.infer<typeof answerPropertyQuestionSchema>,
) {
  return searchProperty(args.query);
}
