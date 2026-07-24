import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { draftForCampaign, getCampaignById } from "@/lib/campaigns";
import { createAdminClient } from "@/lib/supabase";

/**
 * On-demand trigger for a single campaign, by id — the minimal API surface
 * for a one-off (is_recurring = false) campaign to actually be exercised
 * end-to-end without a campaign-builder UI existing yet (deferred, separate
 * work). Also usable to manually re-run a recurring campaign outside its
 * normal cron cadence (e.g. to catch up after the cron missed a run) — this
 * route doesn't check is_recurring/enabled at all, unlike
 * POST /api/cron/check-stalled-guests's automatic scan; it runs whatever
 * campaign row the id points to, once, regardless of those flags.
 *
 * Guarded by requireApiKey (CRM_API_KEY), same as every other route in this
 * app. Runs the same getCampaignCandidates -> alreadyNudgedGuestIds ->
 * issue promo code -> renderCampaignMessage -> postCampaignDraft pipeline
 * as the cron (apps/crm/src/lib/campaigns.ts's draftForCampaign is the exact
 * same function both call), so a one-off campaign's candidates get the same
 * dedup guard and per-candidate delivery-failure isolation as the two
 * automated ones.
 *
 * Returns `{ campaign_id, kind, drafted, skipped }` on success, 404 with
 * `{ error: "Not found" }` if the id doesn't match any campaigns row, or 500
 * with `{ error }` on any other unexpected failure.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const supabase = createAdminClient();

  try {
    const campaign = await getCampaignById(supabase, id);
    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { drafted, skipped } = await draftForCampaign(supabase, campaign);
    return NextResponse.json({
      campaign_id: campaign.id,
      kind: campaign.kind,
      drafted,
      skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
