import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

// createOpenRouter() with no `apiKey` option reads `OPENROUTER_API_KEY` from the
// environment lazily (per-request), the same way the previous Mastra model-gateway
// magic string relied on an env var being present — see .env.example / README.md.
const openrouter = createOpenRouter();

export const digestSchema = z.object({
  summary: z.string(),
});

/**
 * Decide step (spec §Loop): no dispatch targets exist yet, so this agent's only
 * job is a one-line framing sentence for the digest. It is NOT the source of
 * truth for numbers or anomalies — those are computed deterministically in
 * core/models.ts (detectAnomalies, renderReport) from the real Analyze output,
 * and passed into this agent's prompt as the only data it's allowed to talk
 * about. No tools: giving it its own fetch capability let it skip straight to
 * inventing data instead of using what Analyze already fetched.
 */
export function createReporterAgent() {
  return new Agent({
    id: "reporter-agent",
    name: "Orch-A Reporter",
    description: "Writes a one-line framing sentence for the scheduled digest.",
    instructions:
      "You will be given the exact current Availability and Finance data as JSON " +
      "in the prompt, plus a list of anomalies already detected from that data. " +
      "Write exactly one short, plain-English sentence framing the overall state " +
      '(e.g. "Steady month, one room could use attention."). Rules: only refer ' +
      "to properties that literally appear in the given JSON — never invent a " +
      "property, number, or event that isn't there. Do not restate every number. " +
      "Do not use markdown, HTML, or any formatting characters (no #, *, _, <, >) " +
      "— plain prose only. If the given anomalies list is empty, do not imply " +
      "there's a problem.",
    model: openrouter.chat("deepseek/deepseek-v4-pro"),
  });
}
