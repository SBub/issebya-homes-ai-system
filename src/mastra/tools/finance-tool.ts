import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchFinance, financeSnapshotSchema } from "../../tools/finance.js";

export function createFinanceTool() {
  return createTool({
    id: "get-finance",
    description:
      "Fetch current Finance state (revenue, outstanding payouts) directly from Supabase.",
    inputSchema: z.object({}),
    outputSchema: z.array(financeSnapshotSchema),
    execute: async () => fetchFinance(),
  });
}
