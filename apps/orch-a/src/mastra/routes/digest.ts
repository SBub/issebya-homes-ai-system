import { registerApiRoute } from "@mastra/core/server";
import { type DigestResult, digestResultSchema } from "../../core/models.js";

/**
 * Plain logic endpoint — no Telegram knowledge at all, matching the
 * apps/social-media (`POST /api/generate`) and apps/notifications
 * (`GET /api/reminders/due`) precedent exactly: apps/telegram-router calls
 * this on its own schedule (`POST /api/cron/check-digest`) and sends the
 * result via Telegram itself, with `parse_mode: "HTML"` preserved.
 *
 * Runs Analyze -> Decide -> Dispatch (no-op) -> Report (render-only, no
 * send) and returns the reportSchema-shaped data plus the fully-rendered
 * digest text. A successful call is also Orch-A's heartbeat (see the
 * `report` step in heartbeat-workflow.ts) — this replaces the old
 * "sendReport ran" signal now that sending moved to the router.
 *
 * Registered as a Mastra custom API route (`registerApiRoute`,
 * `@mastra/core/server`) rather than relying on Mastra's own auto-generated
 * `/api/workflows/:id/start-async` endpoint: that built-in endpoint is
 * POST-only, wraps the result in a run-lifecycle envelope tied to
 * create-run/start semantics, and can't be scoped to "just this workflow's
 * output shape" without a bespoke response contract anyway — a custom route
 * gets a plain `GET`, a stable JSON shape, and its own auth in a few lines,
 * while still running the exact same Mastra workflow object in-process.
 *
 * One consequence: `registerApiRoute()` rejects paths starting with the
 * server's `apiPrefix` (default `/api`, reserved for Mastra's built-in
 * routes) — confirmed empirically against a running `mastra dev` server, see
 * the refactor notes. So this is reachable at `GET /digest`, not
 * `GET /api/digest`.
 */
export const digestRoute = registerApiRoute("/digest", {
  method: "GET",
  openapi: {
    summary: "Generate the current Orch-A digest",
    description:
      "Runs Analyze -> Decide (Dispatch is a no-op, Report only formats — no Telegram " +
      "side effects) and returns the digest data plus ready-to-send Telegram-HTML text.",
    tags: ["Digest"],
    responses: {
      200: { description: "Digest generated" },
      401: { description: "Missing or invalid X-API-Key" },
      500: { description: "Digest generation failed" },
    },
  },
  handler: async (c) => {
    const expectedKey = process.env.ORCH_A_API_KEY;
    if (!expectedKey) {
      console.error("[orch-a] ORCH_A_API_KEY is not set — all /digest requests will be rejected");
    }
    const providedKey = c.req.header("X-API-Key");
    if (!expectedKey || providedKey !== expectedKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const workflow = c.get("mastra").getWorkflow("heartbeatWorkflow");
    const run = await workflow.createRun();
    const result = await run.start({ inputData: {} });
    if (result.status !== "success") {
      console.error("[orch-a] digest generation failed", result);
      return c.json({ error: "digest generation failed" }, 500);
    }

    const digest: DigestResult = digestResultSchema.parse(result.result);
    return c.json(digest);
  },
});
