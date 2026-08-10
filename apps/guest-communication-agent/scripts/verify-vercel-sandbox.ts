// THROWAWAY verification script — proves Vercel Sandbox creds/connectivity
// work end to end before wiring runCode into the real agent. Not part of the
// app; run manually with:
//   yarn tsx --env-file=.env.vercel.local scripts/verify-vercel-sandbox.ts
// Delete (or keep as a smoke test) once verified.
import { Sandbox } from "@vercel/sandbox";

async function main() {
  console.log("Creating sandbox...");
  const sandbox = await Sandbox.create({
    timeout: 60_000,
  });
  console.log(`Sandbox ${sandbox.name} created`);

  try {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["-e", "console.log(JSON.stringify({ hello: 'from vercel sandbox', sum: 2 + 2 }))"],
    });
    const stdout = await result.stdout();
    console.log("exitCode:", result.exitCode);
    console.log("stdout:", stdout.trim());
  } finally {
    await sandbox.stop();
    console.log("Sandbox stopped");
  }
}

main().catch((err) => {
  console.error("verify-vercel-sandbox failed:", err);
  process.exit(1);
});
