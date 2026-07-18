import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type pg from "pg";
import { z } from "zod";
import { createAvailabilityTool } from "../tools/availability-tool.js";
import { createFinanceTool } from "../tools/finance-tool.js";

// createOpenRouter() with no `apiKey` option reads `OPENROUTER_API_KEY` from the
// environment lazily (per-request), the same way the previous Mastra model-gateway
// magic string relied on an env var being present — see .env.example / README.md.
const openrouter = createOpenRouter();

export const digestSchema = z.object({
  summary: z.string(),
  anomalies: z.array(z.string()),
});

/**
 * Decide step (spec §Loop): no dispatch targets exist yet, so this agent's whole
 * job is to turn Availability + Finance into a short factual digest.
 */
export function createReporterAgent(pool: pg.Pool) {
  return new Agent({
    id: "reporter-agent",
    name: "Orch-A Reporter",
    description: "Formats current Availability and Finance state into a factual digest.",
    instructions:
      "You are Orch-A's reporting step. Given the current Availability and Finance " +
      "state, write a short factual summary and list any anomalies (e.g. unusually " +
      "low occupancy, negative/zero revenue, stale-looking numbers). Do not " +
      "speculate beyond the data. There is nothing to dispatch to yet — only report.",
    model: openrouter.chat("deepseek/deepseek-v4-pro"),
    tools: {
      getAvailability: createAvailabilityTool(pool),
      getFinance: createFinanceTool(pool),
    },
  });
}
