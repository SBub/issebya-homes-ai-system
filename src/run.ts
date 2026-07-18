import { heartbeatWorkflow, pool } from "./mastra/index.js";

async function main(): Promise<number> {
  const run = await heartbeatWorkflow.createRun();
  const result = await run.start({ inputData: {} });
  if (result.status === "success") {
    console.log("orch-a run complete", result.result);
    return 0;
  }
  console.error("orch-a run did not succeed", result);
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // A single crashed run must not prevent the next scheduled run (spec DoD).
    // This process exits non-zero for monitoring; the scheduler owns retry/cadence.
    console.error("orch-a run failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
