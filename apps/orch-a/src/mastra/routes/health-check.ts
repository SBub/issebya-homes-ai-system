import { registerApiRoute } from "@mastra/core/server";

/**
 * Shallow liveness check — process/HTTP responds, nothing else. Skips a DB
 * round-trip: checkHeartbeat (../../health/checks.ts) already answers
 * "was Postgres reachable during the last scheduled run"; this route answers
 * the different question "is it up right now," which a shallow response
 * already proves. Called by apps/telegram-router's check-health cron /
 * /heartbeat command — same registerApiRoute pattern and auth as
 * ./digest.ts, see that file's doc comment for why a custom route instead of
 * Mastra's own auto-generated endpoints.
 *
 * Registered at /health-check, not /health: confirmed empirically that
 * @mastra/deployer ships its own built-in GET /health (an unauthenticated
 * liveness endpoint for the Mastra server itself), which silently shadows
 * any custom route registered at that exact path — a custom handler there
 * never even runs, so /health always answered 200 regardless of the
 * X-API-Key header. Same class of reserved-path collision as /digest
 * dodging Mastra's /api prefix, just a specific path this time rather than
 * a whole prefix.
 */
export const healthRoute = registerApiRoute("/health-check", {
  method: "GET",
  openapi: {
    summary: "Liveness check",
    description: "Confirms the process is up and answering requests.",
    tags: ["Health"],
    responses: {
      200: { description: "Healthy" },
      401: { description: "Missing or invalid X-API-Key" },
    },
  },
  handler: async (c) => {
    const expectedKey = process.env.ORCH_A_API_KEY;
    if (!expectedKey) {
      console.error(
        "[orch-a] ORCH_A_API_KEY is not set — all /health-check requests will be rejected",
      );
    }
    const providedKey = c.req.header("X-API-Key");
    if (!expectedKey || providedKey !== expectedKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return c.json({ ok: true });
  },
});
