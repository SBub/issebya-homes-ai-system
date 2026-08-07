import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";
import { withSpan } from "@/lib/tracing";

/**
 * Deep liveness check — Supabase is this app's only real dependency besides
 * Twilio/OpenRouter/Braintrust (all guest-facing, not app-liveness). If
 * Postgres is unreachable the Next.js process stays up and answers HTTP
 * fine, but every inbound webhook silently 500s recording the message — a
 * shallow "process responds" check would miss exactly that failure mode.
 * Matches the existing pattern in apps/finance
 * (GET, X-API-Key-guarded, deep = real query against Postgres).
 *
 * `{ head: true, count: "exact" }` issues a HEAD request — Supabase/
 * PostgREST returns just the row count in a header, no rows fetched — the
 * cheapest real round trip to Postgres this client can make.
 *
 * Wrapped in its own withSpan (not withTurnSpan) — this isn't part of any
 * guest turn, just its own standalone root span, so a Supabase outage shows
 * up in the same aggregate error-rate query as every other instrumented
 * operation in this app, not just in this endpoint's own response.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    await withSpan("health.supabase_probe", { "db.table": "whatsapp_conversations" }, async () => {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from("whatsapp_conversations")
        .select("id", { head: true, count: "exact" });
      if (error) throw error;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
