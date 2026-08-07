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
 *
 * Empty since 2026-08-07: check-reminders was removed along with
 * apps/notifications (its sole reason to exist). check-health isn't
 * listed here either — a pre-existing gap, not introduced by that removal.
 */
const CRON_JOBS: CronJob[] = [];

export function renderCronJobsList(): string {
  const lines = ["Available cron jobs:", ""];
  for (const job of CRON_JOBS) {
    lines.push(`• ${job.name} — ${job.description}`, `  ${job.endpoint}`);
  }
  lines.push("", "None of these are on a real schedule yet — still an open deployment question.");
  return lines.join("\n");
}
