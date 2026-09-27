/**
 * Deletes Vercel preview deployments nobody can still need, for this repo's
 * three Vercel projects only (issue #158).
 *
 * The problem: the sbubs-projects team is on the Hobby plan, whose deployment
 * retention is fixed (30 days, keep 10) and cannot be changed from the
 * dashboard or the API. scripts/vercel-ignore.sh cuts how many previews get
 * built, but nothing removes the ones the fixed policy keeps, and Deployment
 * Storage fills up.
 *
 * The rule (scripts/lib/vercel-prune.ts, unit-tested from apps/website):
 * READY previews older than 7 days, except the newest preview of a branch
 * still on origin, and CANCELED/ERROR deployments older than 1 day. A
 * production deployment is never selected.
 *
 * Dry run by default; nothing is deleted without `--apply`. The project list
 * below is a constant on purpose: other projects in the team are out of
 * bounds and are never discovered from the API.
 *
 * Usage: VERCEL_TOKEN=… VERCEL_TEAM_ID=… yarn vercel:prune [--apply]
 * Scheduled weekly with --apply by .github/workflows/vercel-prune.yml.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import {
  DEFAULT_OPTIONS,
  type Deployment,
  type Listing,
  parseLsRemoteHeads,
  planProject,
} from "./lib/vercel-prune";

const PROJECTS = [
  "ihas-website",
  "ihas-guest-communication-agent",
  "ihas-telegram-router",
] as const;

const API = "https://api.vercel.com";
const RETRY_DELAY_MS = 2_000;

type Summary = {
  project: string;
  listed: number;
  candidates: number;
  deleted: number;
  failed: number;
  error?: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function snippet(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `${res.status} ${body.slice(0, 200)}`.trim();
}

async function listAll(project: string, token: string, teamId: string): Promise<Listing> {
  const deployments: Deployment[] = [];
  let until: number | null = null;
  const seen = new Set<number>();
  try {
    for (;;) {
      const params = new URLSearchParams({ teamId, projectId: project, limit: "100" });
      if (until !== null) params.set("until", String(until));
      const res = await fetch(`${API}/v6/deployments?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { ok: false, error: await snippet(res) };
      const body = (await res.json()) as {
        deployments?: Deployment[];
        pagination?: { next?: number | null };
      };
      if (!Array.isArray(body.deployments)) {
        return { ok: false, error: "response has no deployments array" };
      }
      deployments.push(...body.deployments);
      const next = body.pagination?.next ?? null;
      if (next === null) return { ok: true, deployments };
      if (seen.has(next))
        return { ok: false, error: `pagination cursor did not advance (${next})` };
      seen.add(next);
      until = next;
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A 404 counts as success: the deployment is already gone (e.g. Vercel's own retention). */
async function deleteOnce(
  uid: string,
  token: string,
  teamId: string,
): Promise<{ ok: true; gone: boolean } | { ok: false; error: string }> {
  try {
    const params = new URLSearchParams({ teamId });
    const res = await fetch(`${API}/v13/deployments/${encodeURIComponent(uid)}?${params}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, gone: false };
    if (res.status === 404) return { ok: true, gone: true };
    return { ok: false, error: await snippet(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function deleteWithRetry(uid: string, token: string, teamId: string) {
  const first = await deleteOnce(uid, token, teamId);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return deleteOnce(uid, token, teamId);
}

function writeStepSummary(summaries: Summary[], apply: boolean) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const deletedHeader = apply ? "deleted" : "would-delete";
  const rows = summaries.map((s) =>
    s.error
      ? `| ${s.project} | - | - | - | - | listing failed: ${s.error.replace(/\|/g, "\\|")} |`
      : `| ${s.project} | ${s.listed} | ${s.candidates} | ${apply ? s.deleted : s.candidates} | ${s.failed} | |`,
  );
  const table = [
    `### Vercel preview prune (${apply ? "APPLY" : "DRY RUN"})`,
    "",
    `| project | listed | candidates | ${deletedHeader} | failed | note |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  appendFileSync(file, table);
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--apply");
  if (unknown.length > 0)
    fail(`Unknown argument(s): ${unknown.join(" ")}. Only --apply is accepted.`);
  const apply = args.includes("--apply");

  const token = process.env.VERCEL_TOKEN ?? "";
  const teamId = process.env.VERCEL_TEAM_ID ?? "";
  if (!token) {
    fail(
      "VERCEL_TOKEN is not set. Create a team-scoped token at vercel.com → Account → Tokens and add it as repo secret VERCEL_TOKEN. Refusing to run.",
    );
  }
  if (!teamId) fail("VERCEL_TEAM_ID is not set. Refusing to run.");

  let liveBranches: Set<string>;
  try {
    liveBranches = parseLsRemoteHeads(
      execFileSync("git", ["ls-remote", "--heads", "origin"], { encoding: "utf8" }),
    );
  } catch (err) {
    fail(
      `git ls-remote --heads origin failed (${err instanceof Error ? err.message : String(err)}). Refusing to run without the live branch list.`,
    );
  }
  if (!liveBranches.has("develop") && !liveBranches.has("master")) {
    fail(
      `git ls-remote returned ${liveBranches.size} branches, none of them develop or master. Refusing to run on a branch list that looks wrong.`,
    );
  }

  const now = Date.now();
  const opts = DEFAULT_OPTIONS;
  console.log(
    `Vercel preview prune: ${apply ? "APPLY" : "DRY RUN (nothing will be deleted)"}, team=${teamId}, live branches=${liveBranches.size}, maxAgeDays=${opts.maxAgeDays}, failedMaxAgeDays=${opts.failedMaxAgeDays}`,
  );

  let runFailed = false;
  const summaries: Summary[] = [];

  for (const project of PROJECTS) {
    console.log(`\n${project}`);
    const plan = planProject(await listAll(project, token, teamId), liveBranches, now, opts);
    if (plan.error) {
      console.log(
        `::error::${project}: could not list deployments (${plan.error}); skipped, nothing deleted`,
      );
      runFailed = true;
      summaries.push({
        project,
        listed: 0,
        candidates: 0,
        deleted: 0,
        failed: 0,
        error: plan.error,
      });
      continue;
    }

    const candidates = [...plan.candidates].sort((a, b) => b.ageDays - a.ageDays);
    let deleted = 0;
    let failed = 0;
    for (const c of candidates) {
      const line = `  ${c.uid} ${c.branch ?? "-"} ${c.ageDays.toFixed(1)} ${c.reason}`;
      if (!apply) {
        console.log(line);
        continue;
      }
      const result = await deleteWithRetry(c.uid, token, teamId);
      if (result.ok) {
        deleted++;
        console.log(result.gone ? `${line} (already gone, 404)` : line);
      } else {
        failed++;
        runFailed = true;
        console.log(`::error::${project} delete ${c.uid} failed: ${result.error}`);
      }
    }

    console.log(
      apply
        ? `${project}: listed=${plan.listed} candidates=${candidates.length} deleted=${deleted} failed=${failed}`
        : `${project}: listed=${plan.listed} candidates=${candidates.length} would-delete=${candidates.length} (dry run, nothing deleted)`,
    );
    summaries.push({
      project,
      listed: plan.listed,
      candidates: candidates.length,
      deleted,
      failed,
    });
  }

  writeStepSummary(summaries, apply);
  if (runFailed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
