import { z } from "zod";
import { type AvailabilitySnapshot, availabilitySnapshotSchema } from "../tools/availability.js";
import { type FinanceSnapshot, financeSnapshotSchema } from "../tools/finance.js";

const healthStatusSchema = z.enum(["ok", "stale", "missing"]);

const healthCheckResultSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  detail: z.string(),
});

export const analysisSchema = z.object({
  availability: z.array(availabilitySnapshotSchema),
  finance: z.array(financeSnapshotSchema),
  health: z.array(healthCheckResultSchema),
});

/** What Decide formats and Report sends. No dispatch targets in v0.1.0. */
export const reportSchema = z.object({
  summary: z.string(),
  availability: z.array(availabilitySnapshotSchema),
  finance: z.array(financeSnapshotSchema),
  anomalies: z.array(z.string()),
  health: z.array(healthCheckResultSchema),
});
export type Report = z.infer<typeof reportSchema>;

/** What the digest endpoint (GET /digest) actually returns: the Report fields
 * plus the fully-rendered Telegram-HTML text, ready for apps/telegram-router
 * to send as-is (parse_mode: "HTML") without doing any formatting itself. */
export const digestResultSchema = reportSchema.extend({ text: z.string() });
export type DigestResult = z.infer<typeof digestResultSchema>;

const LOW_OCCUPANCY_THRESHOLD = 0.3;

/** Deterministic — never trust an LLM to both invent and flag the numbers it's summarizing. */
export function detectAnomalies(
  availability: AvailabilitySnapshot[],
  finance: FinanceSnapshot[],
): string[] {
  const anomalies: string[] = [];
  for (const a of availability) {
    if (a.occupancyRateNext30d < LOW_OCCUPANCY_THRESHOLD) {
      const pct = Math.round(a.occupancyRateNext30d * 100);
      anomalies.push(`${a.propertyName}: low occupancy (${pct}%)`);
    }
  }
  for (const f of finance) {
    if (f.revenueMonthToDate === 0) {
      anomalies.push(`${prettifyPropertyId(f.propertyId)}: zero revenue recorded`);
    }
  }
  return anomalies;
}

function prettifyPropertyId(id: string): string {
  const match = id.match(/^room(\d+)$/);
  return match ? `Room ${match[1]}` : id;
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram HTML parse mode: only &, <, > need escaping. LLM output (summary)
 * is untrusted free text and gets escaped; everything else is our own data. */
export function renderReport(report: Report): string {
  const lines: string[] = ["<b>Orch-A Daily Digest</b>", ""];

  if (report.summary) {
    lines.push(`<i>${escapeHtml(report.summary)}</i>`, "");
  }

  lines.push("<b>Availability (next 30d)</b>");
  for (const a of report.availability) {
    const pct = Math.round(a.occupancyRateNext30d * 100);
    lines.push(
      `• ${escapeHtml(a.propertyName)}: ${a.availableNightsNext30d}/30 nights open (${pct}% occupied)`,
    );
  }

  lines.push("", "<b>Finance</b>");
  for (const f of report.finance) {
    lines.push(
      `• ${escapeHtml(prettifyPropertyId(f.propertyId))}: ${formatCurrency(f.revenueMonthToDate)} revenue · ${formatCurrency(f.outstandingPayouts)} outstanding`,
    );
  }

  if (report.anomalies.length > 0) {
    lines.push("", "<b>Needs attention</b>");
    lines.push(...report.anomalies.map((a) => `• ${escapeHtml(a)}`));
  }

  const healthOk = report.health.every((h) => h.status === "ok");
  lines.push(
    "",
    `${healthOk ? "✅" : "🔴"} Health: ${report.health.map((h) => `${h.name} ${h.status}`).join(" · ")}`,
  );

  return lines.join("\n");
}
