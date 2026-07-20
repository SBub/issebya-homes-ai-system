import { Mastra } from "@mastra/core/mastra";
import { loadSettings } from "../config.js";
import { createPool } from "../db.js";
import { createReporterAgent } from "./agents/reporter-agent.js";
import { digestRoute } from "./routes/digest.js";
import { createHeartbeatWorkflow } from "./workflows/heartbeat-workflow.js";

const settings = loadSettings();
export const pool = createPool(settings.DATABASE_URL);

const reporterAgent = createReporterAgent();
export const heartbeatWorkflow = createHeartbeatWorkflow(pool, settings, reporterAgent);

export const mastra = new Mastra({
  agents: { reporterAgent },
  workflows: { heartbeatWorkflow },
  server: {
    apiRoutes: [digestRoute],
  },
});
