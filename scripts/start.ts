import { spawn, spawnSync } from "node:child_process";

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

function commandExists(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function main(): void {
  if (!commandExists("docker")) {
    console.error(
      "docker not found — install Docker Desktop, it's required to run Supabase locally.",
    );
    process.exit(1);
  }
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    console.error("Docker daemon isn't running — start Docker Desktop and try again.");
    process.exit(1);
  }
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

  console.log("\nStarting Mastra dev server (API + Playground/Studio)...\n");
  // `npx mastra dev` spawns further child processes of its own (the mastra
  // binary, then a bundled server process) — detached + killing the whole
  // process group is what makes sure none of them survive as orphans.
  const mastraDev = spawn("npx", ["mastra", "dev"], { stdio: "inherit", detached: true });

  const shutdown = (signal: NodeJS.Signals) => {
    if (mastraDev.pid) {
      try {
        process.kill(-mastraDev.pid, signal);
      } catch {
        // process group already gone
      }
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  mastraDev.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main();
