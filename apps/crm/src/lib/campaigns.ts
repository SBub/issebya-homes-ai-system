import crypto from "node:crypto";
import { CAMPAIGN_MESSAGES, type CampaignKind } from "./campaign-messages";
import type { createAdminClient } from "./supabase";
import { postCampaignDraft } from "./telegram-router-client";

// Loose alias rather than importing @supabase/supabase-js's SupabaseClient
// type directly — every function here only needs whatever createAdminClient
// actually returns, and taking it as a parameter (instead of constructing
// its own client) is what makes each function testable with a plain mock
// object, same "pass the client in" shape as this file's own callers.
type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

const SEASONAL_NUDGE_THRESHOLD_DAYS = 3;
const STALLED_LINK_NUDGE_THRESHOLD_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const CAMPAIGN_NAMES: Record<CampaignKind, string> = {
  seasonal_nudge: "Seasonal check-in (automated)",
  stalled_link_nudge: "Stalled booking-link follow-up (automated)",
};

interface GuestCandidate {
  id: string;
  phone: string | null;
}

export interface CheckStalledGuestsSummary {
  seasonal_nudge_drafted: number;
  stalled_link_nudge_drafted: number;
  skipped_already_nudged: number;
}

/**
 * Finds this campaign's persistent row by kind, or creates it the first
 * time this cron ever runs for that kind. Campaigns are meant to be
 * long-lived and reused every cron run, NOT created fresh each time — hence
 * find-or-create rather than a plain insert.
 */
export async function findOrCreateCampaign(
  supabase: SupabaseAdminClient,
  kind: CampaignKind,
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("campaigns")
    .select("id")
    .eq("kind", kind)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }
  if (existing) {
    return existing.id as string;
  }

  const { data: created, error: insertError } = await supabase
    .from("campaigns")
    .insert({ kind, name: CAMPAIGN_NAMES[kind] })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }
  return created.id as string;
}

/** funnel_stage='new' guests who haven't interacted in >3 days — seasonal_nudge candidates. */
export async function getSeasonalNudgeCandidates(
  supabase: SupabaseAdminClient,
): Promise<GuestCandidate[]> {
  const threshold = new Date(Date.now() - SEASONAL_NUDGE_THRESHOLD_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("guest_contacts")
    .select("id, phone")
    .eq("funnel_stage", "new")
    .not("last_interaction_at", "is", null)
    .lt("last_interaction_at", threshold);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

/** funnel_stage='link_sent' guests who haven't interacted in >5 days — stalled_link_nudge candidates. */
export async function getStalledLinkNudgeCandidates(
  supabase: SupabaseAdminClient,
): Promise<GuestCandidate[]> {
  const threshold = new Date(Date.now() - STALLED_LINK_NUDGE_THRESHOLD_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("guest_contacts")
    .select("id, phone")
    .eq("funnel_stage", "link_sent")
    .lt("last_interaction_at", threshold);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

/**
 * Dedup guard, deliberately simple — a v1 simplification, not an oversight:
 * ANY promo_codes row already existing for a (guest_contact_id, campaign_id)
 * pair means "already nudged, never nudge again for this campaign",
 * regardless of that row's status. issued/sent/rejected/expired/redeemed all
 * count the same here. There is intentionally no re-nudge-after-rejection
 * logic in this version.
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
 * Issues a promo_codes row (unique code + drafted message_text) for each
 * true candidate — i.e. every candidate not already nudged for this
 * campaign per alreadyNudgedGuestIds — then best-effort pushes each one to
 * apps/telegram-router for owner approve/reject via postCampaignDraft. A
 * postCampaignDraft failure only logs a warning: it never rolls back the
 * already-committed promo_codes insert (see telegram-router-client.ts's own
 * doc comment for the resilience reasoning).
 */
async function draftForCandidates(
  supabase: SupabaseAdminClient,
  campaignId: string,
  campaignKind: CampaignKind,
  candidates: GuestCandidate[],
): Promise<{ drafted: number; skipped: number }> {
  const alreadyNudged = await alreadyNudgedGuestIds(
    supabase,
    campaignId,
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
    const messageText = CAMPAIGN_MESSAGES[campaignKind];

    const { data: promoCode, error: insertError } = await supabase
      .from("promo_codes")
      .insert({
        campaign_id: campaignId,
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
      campaignKind,
      guestPhone: candidate.phone,
      messageText,
    });
    if (!draftResult.ok) {
      console.warn(
        `[crm] postCampaignDraft failed for promo code ${promoCode.id} (campaign ${campaignKind}): ${draftResult.error}`,
      );
    }
  }

  return { drafted, skipped };
}

/**
 * Orchestrates the whole check-stalled-guests cron run — find-or-create
 * both persistent campaigns, pull each one's candidates, dedup, draft. See
 * apps/crm/src/app/api/cron/check-stalled-guests/route.ts (this function's
 * only caller) for the auth/response wiring around it.
 */
export async function runCheckStalledGuests(
  supabase: SupabaseAdminClient,
): Promise<CheckStalledGuestsSummary> {
  const seasonalCampaignId = await findOrCreateCampaign(supabase, "seasonal_nudge");
  const stalledCampaignId = await findOrCreateCampaign(supabase, "stalled_link_nudge");

  const seasonalCandidates = await getSeasonalNudgeCandidates(supabase);
  const stalledCandidates = await getStalledLinkNudgeCandidates(supabase);

  const seasonalResult = await draftForCandidates(
    supabase,
    seasonalCampaignId,
    "seasonal_nudge",
    seasonalCandidates,
  );
  const stalledResult = await draftForCandidates(
    supabase,
    stalledCampaignId,
    "stalled_link_nudge",
    stalledCandidates,
  );

  return {
    seasonal_nudge_drafted: seasonalResult.drafted,
    stalled_link_nudge_drafted: stalledResult.drafted,
    skipped_already_nudged: seasonalResult.skipped + stalledResult.skipped,
  };
}
