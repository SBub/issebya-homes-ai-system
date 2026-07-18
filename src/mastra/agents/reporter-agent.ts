import { Agent } from "@mastra/core/agent";
import type pg from "pg";
import { z } from "zod";
import { createAvailabilityTool } from "../tools/availability-tool.js";
import { createFinanceTool } from "../tools/finance-tool.js";

export const digestSchema = z.object({
  summary: z.string(),
  anomalies: z.array(z.string()),
});
export type Digest = z.infer<typeof digestSchema>;

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
    model: "anthropic/claude-sonnet-5",
    tools: {
      getAvailability: createAvailabilityTool(pool),
      getFinance: createFinanceTool(pool),
    },
  });
}
