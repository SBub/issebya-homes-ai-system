import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { runCheckStalledGuests } from "@/lib/campaigns";
import { createAdminClient } from "@/lib/supabase";

/**
 * Stage-2 orchestration cron for campaign-conversion-tracking. Whatever real
 * scheduler ends up existing (still an open deployment question — see
 * apps/telegram-router's own check-* cron routes for the same open
 * question) should call this on a fixed interval, e.g. daily.
 *
 * Guarded by requireApiKey (CRM_API_KEY) like every other route in this
 * app — CRM has no separate cron-secret mechanism the way
 * apps/telegram-router's check-* routes do (X-Cron-Secret), and that's
 * fine, not something to invent here just for consistency with a different
 * app.
 *
 * All the actual logic — scan every campaigns row flagged
 * is_recurring+enabled, pull each one's candidates, dedup, draft,
 * best-effort push to apps/telegram-router — lives in
 * ./../../../../lib/campaigns.ts's runCheckStalledGuests, so it's testable
 * without a real Supabase connection. This route is just the auth + wiring +
 * error-to-500 wrapper around it. Adding a new recurring campaign in the
 * future (or turning today's two off) is a data change (a campaigns row),
 * not a code change here.
 *
 * Returns `{ results: [{ campaign_id, kind, drafted, skipped }, ...],
 * total_drafted, total_skipped_already_nudged }` on success, or `{ error }`
 * with 500 on any unexpected failure (a real Supabase error, not a
 * postCampaignDraft failure — that one's already-swallowed inside
 * runCheckStalledGuests, per-candidate, so one candidate's delivery failure
 * never fails the whole cron response).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const supabase = createAdminClient();

  try {
    const summary = await runCheckStalledGuests(supabase);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
