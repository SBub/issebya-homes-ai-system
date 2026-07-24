import crypto from "node:crypto";
import { renderCampaignMessage } from "./campaign-messages";
import type { createAdminClient } from "./supabase";
import { postCampaignDraft } from "./telegram-router-client";

// Loose alias rather than importing @supabase/supabase-js's SupabaseClient
// type directly — every function here only needs whatever createAdminClient
// actually returns, and taking it as a parameter (instead of constructing
// its own client) is what makes each function testable with a plain mock
// object, same "pass the client in" shape as this file's own callers.
type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A campaigns row. kind is a free descriptive label only (display/grouping)
 * — since
 * supabase/migrations/20260724110000_campaigns_data_driven_targeting.sql
 * dropped the old 4-value check constraint, no code branches on its value
 * anymore. Everything that used to be a hardcoded per-kind code branch
 * (which guests qualify, what the message says, whether there's a discount)
 * is now data on the row itself: getCampaignCandidates builds its query from
 * target_funnel_stage/min_idle_days/target_stay_before/min_total_stays
 * (whichever are non-null), and renderCampaignMessage (campaign-messages.ts)
 * fills in message_template from discount_percent/offer_description plus the
 * guest and promo code. is_recurring+enabled is what runCheckStalledGuests
 * scans for; a one-off campaign instead gets triggered directly by id via
 * POST /api/campaigns/:id/run.
 */
export interface Campaign {
  id: string;
  name: string;
  kind: string;
  target_funnel_stage: string | null;
  min_idle_days: number | null;
  target_stay_before: string | null;
  min_total_stays: number | null;
  discount_percent: number | null;
  offer_description: string;
  message_template: string;
  is_recurring: boolean;
  enabled: boolean;
  created_at: string;
}

export interface GuestContact {
  id: string;
  phone: string | null;
  guest_name: string | null;
}

interface CampaignRunSummary {
  campaign_id: string;
  kind: string;
  drafted: number;
  skipped: number;
}

export interface CheckStalledGuestsSummary {
  results: CampaignRunSummary[];
  total_drafted: number;
  total_skipped_already_nudged: number;
}

/**
 * Every campaigns row flagged as both is_recurring and enabled — the set
 * runCheckStalledGuests scans on each cron run. A recurring campaign can be
 * switched off (enabled = false) without deleting its row/history; a one-off
 * campaign is never picked up here regardless of enabled, since it's
 * triggered by id instead (see POST /api/campaigns/:id/run).
 */
export async function getRecurringEnabledCampaigns(
  supabase: SupabaseAdminClient,
): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("is_recurring", true)
    .eq("enabled", true);

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Campaign[];
}

/** Looks up a single campaigns row by id, or null if none exists. */
export async function getCampaignById(
  supabase: SupabaseAdminClient,
  id: string,
): Promise<Campaign | null> {
  const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return (data as Campaign | null) ?? null;
}

/**
 * Generic candidate-selection engine — replaces the old per-kind
 * getSeasonalNudgeCandidates/getStalledLinkNudgeCandidates. Builds its
 * guest_contacts query dynamically from whichever of this campaign's own
 * targeting columns are non-null; a null criterion is simply not applied as
 * a filter, so e.g. a campaign with only min_idle_days set matches guests at
 * any funnel_stage. target_stay_before and min_total_stays aren't used by
 * either of today's two seeded campaigns — they exist for future campaigns
 * to use without another schema change: target_stay_before for a win-back
 * campaign (guests whose last_stay_checkout is before a cutoff date), and
 * min_total_stays for a winter-program-style campaign targeting "everyone
 * who's ever completed a booking" (total_stays >= 1) — a signal funnel_stage
 * can't express, since funnel_stage only tracks the WhatsApp-conversation
 * funnel and a finance-synced guest with no WhatsApp contact yet would still
 * default to 'new' despite having a real completed stay.
 *
 * guest_contacts.enabled is filtered unconditionally, before any of the
 * campaign's own (nullable, per-campaign) targeting columns are applied —
 * see supabase/migrations/20260724130000_add_enabled_to_guest_contacts.sql.
 * Unlike target_funnel_stage/min_idle_days/target_stay_before/
 * min_total_stays, which a campaign can leave null to skip, enabled is not a
 * targeting criterion at all: a guest set to enabled = false (e.g. because
 * they weren't happy with a past stay and shouldn't be bothered further) is
 * excluded from every campaign's candidate set, automated or one-off, full
 * stop — there is no campaign-level switch that brings a disabled guest back
 * in.
 */
export async function getCampaignCandidates(
  supabase: SupabaseAdminClient,
  campaign: Campaign,
): Promise<GuestContact[]> {
  let query = supabase.from("guest_contacts").select("id, phone, guest_name").eq("enabled", true);

  if (campaign.target_funnel_stage != null) {
    query = query.eq("funnel_stage", campaign.target_funnel_stage);
  }
  if (campaign.min_idle_days != null) {
    const threshold = new Date(Date.now() - campaign.min_idle_days * DAY_MS).toISOString();
    query = query.lt("last_interaction_at", threshold);
  }
  if (campaign.target_stay_before != null) {
    query = query.lt("last_stay_checkout", campaign.target_stay_before);
  }
  if (campaign.min_total_stays != null) {
    query = query.gte("total_stays", campaign.min_total_stays);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as GuestContact[];
}

/**
 * Dedup guard, deliberately simple — a v1 simplification, not an oversight:
 * ANY promo_codes row already existing for a (guest_contact_id, campaign_id)
 * pair means "already nudged, never nudge again for this campaign",
 * regardless of that row's status. issued/sent/rejected/expired/redeemed all
 * count the same here. There is intentionally no re-nudge-after-rejection
 * logic in this version. Kind-agnostic — unaffected by the code-to-data
 * campaign shift.
 */
export async function alreadyNudgedGuestIds(
  supabase: SupabaseAdminClient,
  campaignId: string,
  guestIds: string[],
): Promise<Set<string>> {
  if (guestIds.length === 0) {
    return new Set();
  }

  const { data, error } = await supabase
    .from("promo_codes")
    .select("guest_contact_id")
    .eq("campaign_id", campaignId)
    .in("guest_contact_id", guestIds);

  if (error) {
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row: { guest_contact_id: string }) => row.guest_contact_id));
}

/**
 * Issues a promo_codes row (unique code + rendered message_text) for each
 * true candidate of this campaign — i.e. every getCampaignCandidates result
 * not already nudged per alreadyNudgedGuestIds — then best-effort pushes
 * each one to apps/telegram-router for owner approve/reject via
 * postCampaignDraft. A postCampaignDraft failure only logs a warning: it
 * never rolls back the already-committed promo_codes insert (see
 * telegram-router-client.ts's own doc comment for the resilience reasoning).
 * This is the one function both runCheckStalledGuests (looped over every
 * recurring+enabled campaign) and POST /api/campaigns/:id/run (a single
 * campaign, on demand) call — replaces the old kind-specific
 * draftForCandidates.
 */
export async function draftForCampaign(
  supabase: SupabaseAdminClient,
  campaign: Campaign,
): Promise<{ drafted: number; skipped: number }> {
  const candidates = await getCampaignCandidates(supabase, campaign);
  const alreadyNudged = await alreadyNudgedGuestIds(
    supabase,
    campaign.id,
    candidates.map((candidate) => candidate.id),
  );

  let drafted = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    if (alreadyNudged.has(candidate.id)) {
      skipped += 1;
      continue;
    }

    const code = crypto.randomBytes(6).toString("hex").toUpperCase();
    const messageText = renderCampaignMessage(campaign, candidate, code);

    const { data: promoCode, error: insertError } = await supabase
      .from("promo_codes")
      .insert({
        campaign_id: campaign.id,
        guest_contact_id: candidate.id,
        code,
        message_text: messageText,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    drafted += 1;

    const draftResult = await postCampaignDraft({
      promoCodeId: promoCode.id as string,
      campaignKind: campaign.kind,
      guestPhone: candidate.phone,
      messageText,
    });
    if (!draftResult.ok) {
      console.warn(
        `[crm] postCampaignDraft failed for promo code ${promoCode.id} (campaign ${campaign.kind}): ${draftResult.error}`,
      );
    }
  }

  return { drafted, skipped };
}

/**
 * Orchestrates the whole check-stalled-guests cron run — pulls every
 * campaigns row flagged is_recurring+enabled (today that's just
 * seasonal_nudge and stalled_link_nudge, seeded by
 * 20260724110000_campaigns_data_driven_targeting.sql; adding a third
 * recurring campaign in the future means inserting a row, not touching this
 * function) and runs draftForCampaign once per row. See
 * apps/crm/src/app/api/cron/check-stalled-guests/route.ts (this function's
 * only caller) for the auth/response wiring around it.
 */
export async function runCheckStalledGuests(
  supabase: SupabaseAdminClient,
): Promise<CheckStalledGuestsSummary> {
  const campaigns = await getRecurringEnabledCampaigns(supabase);

  const results: CampaignRunSummary[] = [];
  for (const campaign of campaigns) {
    const { drafted, skipped } = await draftForCampaign(supabase, campaign);
    results.push({ campaign_id: campaign.id, kind: campaign.kind, drafted, skipped });
  }

  return {
    results,
    total_drafted: results.reduce((sum, result) => sum + result.drafted, 0),
    total_skipped_already_nudged: results.reduce((sum, result) => sum + result.skipped, 0),
  };
}
