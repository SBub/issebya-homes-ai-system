import { z } from "zod";
import { availabilitySnapshotSchema } from "../tools/availability.js";
import { financeSnapshotSchema } from "../tools/finance.js";

export const healthStatusSchema = z.enum(["ok", "stale", "missing"]);

export const healthCheckResultSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  detail: z.string(),
});

export const analysisSchema = z.object({
  availability: z.array(availabilitySnapshotSchema),
  finance: z.array(financeSnapshotSchema),
  health: z.array(healthCheckResultSchema),
});
export type Analysis = z.infer<typeof analysisSchema>;

/** What Decide formats and Report sends. No dispatch targets in v0.1.0. */
export const reportSchema = z.object({
  summary: z.string(),
  anomalies: z.array(z.string()),
  health: z.array(healthCheckResultSchema),
});
export type Report = z.infer<typeof reportSchema>;

export function renderReport(report: Report): string {
  const lines = [report.summary];
  if (report.anomalies.length > 0) {
    lines.push("", "Anomalies:", ...report.anomalies.map((a) => `- ${a}`));
  }
  lines.push("", "Health:", ...report.health.map((h) => `- ${h.name}: ${h.status} (${h.detail})`));
  return lines.join("\n");
}
