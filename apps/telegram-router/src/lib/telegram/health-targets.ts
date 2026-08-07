export interface HealthTarget {
  service: string;
  urlEnvVar: string;
  keyEnvVar: string;
  path: string;
}

/**
 * Services this router checks for liveness/reachability — answers "is the
 * process even up."
 *
 * apps/telegram-router itself is deliberately excluded: it's the one running
 * these checks, so a self-check would be trivially always-healthy and add no
 * information. The real answer for monitoring the router's own liveness is
 * external uptime monitoring (hitting its public URL from outside this
 * system entirely) — out of scope here.
 *
 * notifications/finance get a deep check (their own /api/health does a real
 * DB round-trip) since both silently stop doing their one job if their
 * Postgres dependency dies while the process stays up. social-media is
 * shallow (process responds only) — see its own health route for the
 * per-app reasoning.
 */
export const HEALTH_TARGETS: HealthTarget[] = [
  {
    service: "notifications",
    urlEnvVar: "NOTIFICATIONS_API_URL",
    keyEnvVar: "NOTIFICATIONS_API_KEY",
    path: "/api/health",
  },
  {
    service: "finance",
    urlEnvVar: "FINANCE_API_URL",
    keyEnvVar: "FINANCE_API_KEY",
    path: "/api/health",
  },
  {
    service: "social-media",
    urlEnvVar: "SOCIAL_MEDIA_API_URL",
    keyEnvVar: "SOCIAL_MEDIA_API_KEY",
    path: "/api/health",
  },
];

export interface HealthCheckResult {
  service: string;
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 10_000;

/** A timeout or non-200 response both count as unhealthy, same as a real error. */
export async function checkTarget(target: HealthTarget): Promise<HealthCheckResult> {
  const url = process.env[target.urlEnvVar];
  const key = process.env[target.keyEnvVar];
  if (!url || !key) {
    return {
      service: target.service,
      ok: false,
      error: `${target.urlEnvVar}/${target.keyEnvVar} not configured`,
    };
  }

  try {
    const res = await fetch(`${url}${target.path}`, {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { service: target.service, ok: false, error: `${target.path} returned ${res.status}` };
    }
    return { service: target.service, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { service: target.service, ok: false, error: message };
  }
}

export async function checkAllTargets(): Promise<HealthCheckResult[]> {
  return Promise.all(HEALTH_TARGETS.map(checkTarget));
}

export function renderHealthSummary(results: HealthCheckResult[]): string {
  const lines = ["System health:", ""];
  for (const result of results) {
    lines.push(result.ok ? `🟢 ${result.service}: ok` : `🔴 ${result.service}: ${result.error}`);
  }
  return lines.join("\n");
}
