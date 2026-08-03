import { tool } from "ai";
import { z } from "zod";
import { searchProperty } from "../../tools/search-property";

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

export async function runAnswerPropertyQuestion(
  args: z.infer<typeof answerPropertyQuestionSchema>,
) {
  return searchProperty(args.query);
}
