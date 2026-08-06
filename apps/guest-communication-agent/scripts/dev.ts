import { type ChildProcess, spawn, spawnSync } from "node:child_process";

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

function commandExists(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // process group already gone
  }
}

function main(): void {
  if (!commandExists("supabase")) {
    console.error("supabase CLI not found — https://supabase.com/docs/guides/cli/getting-started");
    process.exit(1);
  }

  console.log("Checking local Supabase stack...");
  const alreadyRunning = spawnSync("supabase", ["status"], { stdio: "ignore" }).status === 0;
  if (alreadyRunning) {
    console.log("Supabase already running.");
  } else {
    console.log("Starting Supabase (db, studio, etc.) — this applies supabase/migrations too...");
    const startCode = run("supabase", ["start"]);
    if (startCode !== 0) {
      console.error("`supabase start` failed — see output above.");
      process.exit(startCode);
    }
  }

  console.log(
    "\nStarting Next.js dev server (port 3005) and Inngest Dev Server (dashboard at http://localhost:8288)...\n",
  );

  // `yarn next dev` / `yarn inngest dev` each spawn further child processes of
  // their own — detached + killing the whole process group is what makes sure
  // none of them survive as orphans.
  const nextDev = spawn("yarn", ["next", "dev", "--port", "3005"], {
    stdio: "inherit",
    detached: true,
    env: { ...process.env, INNGEST_DEV: "1" },
  });

  const inngestDev = spawn("yarn", ["inngest", "dev", "-u", "http://localhost:3005/api/inngest"], {
    stdio: "inherit",
    detached: true,
  });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    killGroup(nextDev, signal);
    killGroup(inngestDev, signal);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const handleExit = (name: string, other: ChildProcess) => (code: number | null) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${name} exited (code ${code ?? 0}) — stopping the other dev process...`);
    killGroup(other, "SIGTERM");
    process.exit(code ?? 0);
  };

  nextDev.on("exit", handleExit("Next.js dev server", inngestDev));
  inngestDev.on("exit", handleExit("Inngest Dev Server", nextDev));
}

main();
