import type { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type pg from "pg";
import { z } from "zod";
import type { Settings } from "../../config.js";
import { analysisSchema, detectAnomalies, renderReport, reportSchema } from "../../core/models.js";
import {
  checkAvailabilityFreshness,
  checkFinanceFreshness,
  checkHeartbeat,
} from "../../health/checks.js";
import { sendReport } from "../../reporting/telegram.js";
import { lastRunAt, recordFailedDelivery, recordRun } from "../../storage/persistence.js";
import { fetchAvailability } from "../../tools/availability.js";
import { fetchFinance } from "../../tools/finance.js";
import { digestSchema } from "../agents/reporter-agent.js";

function createAnalyzeStep(pool: pg.Pool, settings: Settings) {
  return createStep({
    id: "analyze",
    description: "Pull current state from Availability and Finance, run health checks.",
    inputSchema: z.object({}),
    outputSchema: analysisSchema,
    execute: async () => {
      const [availability, finance, lastRun] = await Promise.all([
        fetchAvailability(),
        fetchFinance(),
        lastRunAt(pool),
      ]);
      const health = [
        checkHeartbeat(lastRun, settings.HEARTBEAT_STALE_AFTER_MINUTES),
        checkAvailabilityFreshness(availability, settings.AVAILABILITY_STALE_AFTER_HOURS),
        checkFinanceFreshness(finance, settings.FINANCE_STALE_AFTER_HOURS),
      ];
      return { availability, finance, health };
    },
  });
}

function createDecideStep(reporterAgent: Agent) {
  return createStep({
    id: "decide",
    description: "Format Analyze's output into a digest. No dispatch targets exist yet.",
    inputSchema: analysisSchema,
    outputSchema: reportSchema,
    execute: async ({ inputData }) => {
      const anomalies = detectAnomalies(inputData.availability, inputData.finance);
      const prompt =
        `Availability data:\n${JSON.stringify(inputData.availability, null, 2)}\n\n` +
        `Finance data:\n${JSON.stringify(inputData.finance, null, 2)}\n\n` +
        `Anomalies already detected: ${anomalies.length > 0 ? JSON.stringify(anomalies) : "none"}\n\n` +
        "Write the one-sentence framing summary per your instructions.";
      const result = await reporterAgent.generate(prompt, {
        structuredOutput: { schema: digestSchema },
      });
      return {
        summary: result.object.summary,
        availability: inputData.availability,
        finance: inputData.finance,
        anomalies,
        health: inputData.health,
      };
    },
  });
}

// Dispatch: intentionally a passthrough. No delegate agents are wired in v0.1.0
// (see spec Non-goals) — this step exists so later versions slot in without redesign.
const dispatchStep = createStep({
  id: "dispatch",
  description: "No-op in v0.1.0 — no agents wired to dispatch to.",
  inputSchema: reportSchema,
  outputSchema: reportSchema,
  execute: async ({ inputData }) => inputData,
});

function createReportStep(pool: pg.Pool, settings: Settings) {
  return createStep({
    id: "report",
    description: "Send the digest to Telegram, confirm delivery, fall back to a durable record.",
    inputSchema: reportSchema,
    outputSchema: z.object({ delivered: z.boolean() }),
    execute: async ({ inputData }) => {
      const text = renderReport(inputData);
      const result = await sendReport(settings.TELEGRAM_BOT_TOKEN, settings.TELEGRAM_CHAT_ID, text);
      if (!result.delivered) {
        await recordFailedDelivery(pool, text, result.detail);
      }
      await recordRun(pool, new Date());
      return { delivered: result.delivered };
    },
  });
}

export function createHeartbeatWorkflow(pool: pg.Pool, settings: Settings, reporterAgent: Agent) {
  return createWorkflow({
    id: "heartbeat-workflow",
    description: "Orch-A core loop: Analyze -> Decide -> Dispatch (no-op) -> Report.",
    inputSchema: z.object({}),
    outputSchema: z.object({ delivered: z.boolean() }),
  })
    .then(createAnalyzeStep(pool, settings))
    .then(createDecideStep(reporterAgent))
    .then(dispatchStep)
    .then(createReportStep(pool, settings))
    .commit();
}
