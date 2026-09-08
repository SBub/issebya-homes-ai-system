import { serve } from "inngest/next";
import { after } from "next/server";
import { runGuestTurnFunction } from "@/agent/run-guest-turn";
import { flushTracing } from "@/instrumentation";
import { inngest } from "@/lib/inngest";

// Inngest's discovery/execution endpoint — the Dev Server (local) and
// Inngest Cloud (prod) both call this to find and invoke registered
// functions. Must live at /api/inngest for auto-discovery to work (see the
// inngest-setup skill's "Common Gotcha").
const {
  GET,
  POST: servePost,
  PUT,
} = serve({
  client: inngest,
  functions: [runGuestTurnFunction],
});

export { GET, PUT };

// This is where runAgentTurn's steps actually run and emit spans. after()
// schedules the flush to run once the response is sent — Vercel keeps the
// function alive until it resolves (see flushTracing's own comment in
// src/instrumentation.ts) — instead of blocking the response on it.
export const POST: typeof servePost = (req, res) => {
  after(() => flushTracing());
  return servePost(req, res);
};
