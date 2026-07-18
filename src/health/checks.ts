import type { AvailabilitySnapshot } from "../tools/availability.js";
import type { FinanceSnapshot } from "../tools/finance.js";

export type HealthStatus = "ok" | "stale" | "missing";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  detail: string;
}

export function checkHeartbeat(
  lastRun: Date | null,
  staleAfterMinutes: number,
  now: Date = new Date(),
): HealthCheckResult {
  if (lastRun === null) {
    return { name: "heartbeat", status: "missing", detail: "no prior run recorded" };
  }
  const ageMinutes = (now.getTime() - lastRun.getTime()) / 60_000;
  if (ageMinutes > staleAfterMinutes) {
    return {
      name: "heartbeat",
      status: "stale",
      detail: `last run ${Math.round(ageMinutes)}m ago, exceeds ${staleAfterMinutes}m threshold`,
    };
  }
  return { name: "heartbeat", status: "ok", detail: `last run ${Math.round(ageMinutes)}m ago` };
}

export function checkAvailabilityFreshness(
  snapshots: AvailabilitySnapshot[],
  staleAfterHours: number,
  now: Date = new Date(),
): HealthCheckResult {
  return checkFreshness(
    "availability",
    snapshots.map((s) => s.lastUpdated),
    staleAfterHours,
    now,
  );
}

export function checkFinanceFreshness(
  snapshots: FinanceSnapshot[],
  staleAfterHours: number,
  now: Date = new Date(),
): HealthCheckResult {
  return checkFreshness(
    "finance",
    snapshots.map((s) => s.lastUpdated),
    staleAfterHours,
    now,
  );
}

function checkFreshness(
  name: string,
  timestamps: Date[],
  staleAfterHours: number,
  now: Date,
): HealthCheckResult {
  if (timestamps.length === 0) {
    return { name, status: "missing", detail: "no rows returned" };
  }
  const oldest = new Date(Math.min(...timestamps.map((t) => t.getTime())));
  const ageHours = (now.getTime() - oldest.getTime()) / 3_600_000;
  if (ageHours > staleAfterHours) {
    return {
      name,
      status: "stale",
      detail: `oldest row ${ageHours.toFixed(1)}h old, exceeds ${staleAfterHours}h threshold`,
    };
  }
  return { name, status: "ok", detail: `oldest row ${ageHours.toFixed(1)}h old` };
}
