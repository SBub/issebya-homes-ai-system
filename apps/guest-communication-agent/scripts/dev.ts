import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import path from "node:path";

// Where this repo's one shared ngrok tunnel actually terminates. Must match
// scripts/dev-webhook-gateway.ts's own GATEWAY_PORT constant at the repo
// root (not importable from here — that file is a bare side-effecting
// script, importing it would start a second gateway server) — this repo's
// one reserved ngrok domain can only forward to one local port at a time
// (ERR_NGROK_334 on a second simultaneous tunnel), so the gateway fans a
// single inbound port out to every app's webhook by URL path prefix
// (/api/webhook/whatsapp -> this app on 3005, /api/telegram/webhook ->
// telegram-router on 3003). ngrok must point HERE, never directly at this
// app's own port 3005 — pointing it at 3005 makes Twilio's webhook keep
// working (this app happens to serve that exact path itself) while silently
// breaking Telegram's (owner nudge replies/approvals never arrive) — see
// dev-webhook-gateway.ts's own module comment for the full story.
const GATEWAY_PORT = 3010;

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

  // Repo-root process, not this app's own — fans the one shared ngrok
  // tunnel (GATEWAY_PORT above) out to every app's webhook by path. Only
  // routes this app's own /api/webhook/whatsapp and telegram-router's
  // /api/telegram/webhook today (see dev-webhook-gateway.ts's ROUTES table);
  // telegram-router's own `yarn dev` (port 3003) still has to be running
  // separately for that second leg to actually resolve — this only wires up
  // the routing, it doesn't start telegram-router itself, that's a distinct
  // app with its own lifecycle.
  const gatewayDev = spawn("yarn", ["dev:webhook-gateway"], {
    stdio: "inherit",
    detached: true,
    // apps/guest-communication-agent -> apps -> repo root, same two levels
    // this app's own next.config.ts uses for its Turbopack root fix.
    cwd: path.join(process.cwd(), "..", ".."),
  });

  // Twilio's webhook can only reach a real public URL, never localhost
  // directly — TWILIO_WEBHOOK_URL (see .env.development) is that public URL,
  // and its signature check (route.ts's verifyTwilioSignature) is computed
  // against this exact URL, so the tunnel domain must match it exactly, not
  // just any ngrok domain. Derived from the env var (loaded via this
  // package's own `dev` script's `--env-file=.env.development`) rather than
  // hardcoded, so a reserved-domain change only has to happen in one place.
  // Skipped, not fatal, when unset — plenty of local dev work (unit tests,
  // non-webhook routes) doesn't need a live Twilio tunnel at all.
  const ngrokDev = startNgrokTunnel();

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    killGroup(nextDev, signal);
    killGroup(inngestDev, signal);
    killGroup(gatewayDev, signal);
    if (ngrokDev) killGroup(ngrokDev, signal);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const handleExit = (name: string, others: ChildProcess[]) => (code: number | null) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${name} exited (code ${code ?? 0}) — stopping the other dev processes...`);
    for (const other of others) killGroup(other, "SIGTERM");
    process.exit(code ?? 0);
  };

  const allProcesses = ngrokDev
    ? [nextDev, inngestDev, gatewayDev, ngrokDev]
    : [nextDev, inngestDev, gatewayDev];
  nextDev.on(
    "exit",
    handleExit(
      "Next.js dev server",
      allProcesses.filter((p) => p !== nextDev),
    ),
  );
  inngestDev.on(
    "exit",
    handleExit(
      "Inngest Dev Server",
      allProcesses.filter((p) => p !== inngestDev),
    ),
  );
  gatewayDev.on(
    "exit",
    handleExit(
      "Webhook gateway",
      allProcesses.filter((p) => p !== gatewayDev),
    ),
  );
  ngrokDev?.on(
    "exit",
    handleExit(
      "ngrok tunnel",
      allProcesses.filter((p) => p !== ngrokDev),
    ),
  );
}

// Starts `ngrok http --domain=<host> <GATEWAY_PORT>` so Twilio (and, via the
// gateway, Telegram) can reach this dev stack without anyone remembering to
// run ngrok by hand first — a missing tunnel doesn't fail loud (no crash, no
// 401), it just means the webhook request never arrives at all, which
// silently looks like "the agent isn't responding" (confirmed: an empty
// Inngest dev dashboard with zero events, not an error). Points at the
// gateway (GATEWAY_PORT), never at this app's own port 3005 directly — see
// GATEWAY_PORT's own comment for why that distinction matters. ngrok itself,
// unlike supabase above, is not a hard dependency of `yarn dev` — missing it
// only degrades webhook testing, not the rest of local dev — so this warns
// and continues rather than exiting.
function startNgrokTunnel(): ChildProcess | undefined {
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(
      "TWILIO_WEBHOOK_URL not set (see .env.development) — skipping ngrok, webhook calls won't reach this dev stack.",
    );
    return undefined;
  }

  let host: string;
  try {
    host = new URL(webhookUrl).host;
  } catch {
    console.warn(`TWILIO_WEBHOOK_URL ("${webhookUrl}") isn't a valid URL — skipping ngrok.`);
    return undefined;
  }

  if (!commandExists("ngrok")) {
    console.warn(
      "ngrok CLI not found (https://ngrok.com/download) — skipping tunnel, webhook calls won't reach this dev stack.",
    );
    return undefined;
  }

  console.log(`Starting ngrok tunnel on ${host} -> localhost:${GATEWAY_PORT} (webhook gateway)...`);
  return spawn("ngrok", ["http", `--domain=${host}`, String(GATEWAY_PORT)], {
    stdio: "inherit",
    detached: true,
  });
}

main();
