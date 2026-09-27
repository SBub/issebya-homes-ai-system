/**
 * Selection rule for the weekly Vercel preview prune (issue #158).
 *
 * The Hobby plan's deployment retention is fixed at 30 days / keep 10 and
 * cannot be changed from the dashboard or the API, so previews pile up in
 * Deployment Storage. This module decides which deployments nobody can still
 * need. It never selects a production deployment, whatever its age or state.
 *
 * Kept pure (no I/O) so the website's gated `unit` Vitest project can test it;
 * scripts/vercel-prune-previews.ts is the thin CLI around it.
 */

export type Deployment = {
  uid: string;
  state: string; // READY | CANCELED | ERROR | BUILDING | QUEUED | ...
  target?: string | null; // "production" or absent/null for preview
  created: number; // ms since epoch
  meta?: { githubCommitRef?: string } | null;
};

export type Candidate = {
  uid: string;
  branch: string | null;
  ageDays: number;
  reason: "stale-preview" | "failed";
};

export type PruneOptions = { maxAgeDays: number; failedMaxAgeDays: number };

export type Listing = { ok: true; deployments: Deployment[] } | { ok: false; error: string };

type ProjectPlan = { listed: number; candidates: Candidate[]; error?: string };

export const DEFAULT_OPTIONS: PruneOptions = { maxAgeDays: 7, failedMaxAgeDays: 1 };

const DAY_MS = 86_400_000;

export function selectPrunable(
  deployments: readonly Deployment[],
  liveBranches: ReadonlySet<string>,
  now: number,
  opts: PruneOptions,
): Candidate[] {
  const previews = deployments.filter((d) => d.target !== "production");

  // Newest READY preview per live branch, over all ages: an old preview that is
  // still its live branch's newest is the one a reviewer would open, so keep it.
  const newestByBranch = new Map<string, Deployment>();
  for (const d of previews) {
    const branch = d.meta?.githubCommitRef;
    if (d.state !== "READY" || !branch || !liveBranches.has(branch)) continue;
    const current = newestByBranch.get(branch);
    if (!current || d.created > current.created) newestByBranch.set(branch, d);
  }
  const newestLive = new Set([...newestByBranch.values()].map((d) => d.uid));

  const candidates: Candidate[] = [];
  for (const d of previews) {
    // No githubCommitRef (CLI/dashboard deploy): never "newest on a live branch".
    const branch = d.meta?.githubCommitRef ?? null;
    const ageDays = (now - d.created) / DAY_MS;
    if (d.state === "READY" && ageDays > opts.maxAgeDays && !newestLive.has(d.uid)) {
      candidates.push({ uid: d.uid, branch, ageDays, reason: "stale-preview" });
    } else if ((d.state === "CANCELED" || d.state === "ERROR") && ageDays > opts.failedMaxAgeDays) {
      candidates.push({ uid: d.uid, branch, ageDays, reason: "failed" });
    }
  }
  return candidates;
}

export function planProject(
  listing: Listing,
  liveBranches: ReadonlySet<string>,
  now: number,
  opts: PruneOptions,
): ProjectPlan {
  if (!listing.ok) return { listed: 0, candidates: [], error: listing.error };
  return {
    listed: listing.deployments.length,
    candidates: selectPrunable(listing.deployments, liveBranches, now, opts),
  };
}

/** Parses `git ls-remote --heads` output into branch names (which may contain `/`). */
export function parseLsRemoteHeads(output: string): Set<string> {
  const branches = new Set<string>();
  for (const line of output.split("\n")) {
    const ref = line.split("\t")[1]?.trim();
    if (ref?.startsWith("refs/heads/")) branches.add(ref.slice("refs/heads/".length));
  }
  return branches;
}
