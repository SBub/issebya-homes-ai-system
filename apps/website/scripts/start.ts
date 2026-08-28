/**
 * Launch local Supabase, Next.js development server, and Stripe webhook
 * listener. Press Ctrl+C to gracefully terminate all processes.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(path.dirname(PROJECT_ROOT));

const pids: number[] = [];
let shuttingDown = false;

/**
 * Start local Supabase if not already running.
 *
 * Runs against the repo-root Supabase project, not website's own
 * (apps/website/supabase) — for now this repo runs a single local
 * database, so website's local dev points at the root project. Uses
 * `yarn supabase ...` with cwd explicitly set to the repo root, rather than
 * apps/website's own `db:start`/`db:status` scripts — those run `supabase`
 * with cwd = apps/website and would target the wrong (website-local)
 * Supabase project. `supabase` is a real devDependency now (both at the
 * repo root and in apps/website), so `yarn supabase ...` resolves the local
 * CLI binary directly — no more `npx supabase` workaround.
 */
function ensureSupabaseRunning(): void {
  console.log("Checking local Supabase status...");
  const status = spawnSync("yarn", ["supabase", "status"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });

  const notRunning =
    status.status !== 0 || (status.stdout ?? "").toLowerCase().includes("not running");
  if (notRunning) {
    console.log("Starting local Supabase...");
    const start = spawnSync("yarn", ["supabase", "start"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    if (start.status !== 0) {
      console.error("ERROR: Failed to start Supabase. Is Docker running?");
      process.exit(1);
    }
    console.log("Supabase started successfully");
  } else {
    console.log("Supabase already running");
  }
}

/** Kill a process and its direct children (SIGTERM, or SIGKILL to force). */
function killTree(pid: number, force: boolean): void {
  try {
    spawnSync("pkill", [force ? "-9" : "-TERM", "-P", String(pid)], { stdio: "ignore" });
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // process already gone
  }
}

function cleanup(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\nShutting down...");

  // Send SIGTERM to all process trees
  for (const pid of pids) killTree(pid, false);

  // Wait a moment for graceful shutdown, then force kill anything still
  // running.
  setTimeout(() => {
    for (const pid of pids) killTree(pid, true);
    console.log("Done.");
    process.exit(0);
  }, 1000);
}

function main(): void {
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (!existsSync(path.join(REPO_ROOT, "supabase", "config.toml"))) {
    console.error(
      `ERROR: expected repo root at ${REPO_ROOT}, but supabase/config.toml is missing there.`,
    );
    process.exit(1);
  }

  // Kill any process already using port 3000
  const lsof = spawnSync("lsof", ["-ti", ":3000"], { encoding: "utf-8" });
  const pidsOn3000 = (lsof.stdout ?? "").trim();
  if (pidsOn3000) {
    console.log("Killing process on port 3000...");
    spawnSync("kill", ["-9", ...pidsOn3000.split("\n")], { stdio: "ignore" });
  }

  // Ensure local Supabase is running before starting the app
  ensureSupabaseRunning();

  console.log("Starting Next.js development server...");
  const appProc = spawn("yarn", ["dev:next"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "inherit",
  });
  if (appProc.pid) pids.push(appProc.pid);

  console.log("Starting Stripe webhook listener...");
  const webhookProc = spawn("yarn", ["webhook"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "inherit",
  });
  if (webhookProc.pid) pids.push(webhookProc.pid);

  console.log("\nBoth processes running. Press Ctrl+C to stop.\n");

  // If either process exits on its own, tear down the other one too.
  const handleExit = () => {
    if (shuttingDown) return;
    cleanup();
  };
  appProc.on("exit", handleExit);
  webhookProc.on("exit", handleExit);
}

main();
