interface CronJob {
  name: string;
  endpoint: string;
  description: string;
}

/**
 * Static manifest of this router's own cron-triggered endpoints, listed via
 * "/cron list" — the only way to see what exists right now since nothing
 * calls these on a real schedule yet (same open deployment question noted
 * in the README).
 */
const CRON_JOBS: CronJob[] = [
  {
    name: "check-reminders",
    endpoint: "POST /api/cron/check-reminders",
    description: 'sends due reminders from apps/notifications, each with a "✅ Done" button',
  },
  {
    name: "check-digest",
    endpoint: "POST /api/cron/check-digest",
    description: "sends apps/orch-a's daily digest",
  },
];

export function renderCronJobsList(): string {
  const lines = ["Available cron jobs:", ""];
  for (const job of CRON_JOBS) {
    lines.push(`• ${job.name} — ${job.description}`, `  ${job.endpoint}`);
  }
  lines.push("", "None of these are on a real schedule yet — still an open deployment question.");
  return lines.join("\n");
}
