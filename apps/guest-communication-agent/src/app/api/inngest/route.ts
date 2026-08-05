import { serve } from "inngest/next";
import { runGuestTurnFunction } from "@/agent/run-turn";
import { inngest } from "@/lib/inngest";

// Inngest's discovery/execution endpoint — the Dev Server (local) and
// Inngest Cloud (prod) both call this to find and invoke registered
// functions. Must live at /api/inngest for auto-discovery to work (see the
// inngest-setup skill's "Common Gotcha").
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runGuestTurnFunction],
});
