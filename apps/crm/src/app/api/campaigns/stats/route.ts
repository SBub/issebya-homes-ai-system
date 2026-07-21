import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import type { CampaignKind } from "@/lib/campaign-messages";
import { createAdminClient } from "@/lib/supabase";

type PromoCodeStatus = "issued" | "sent" | "redeemed" | "expired" | "rejected";

interface PromoCodeWithCampaignRow {
  status: PromoCodeStatus;
  // supabase-js embeds a "belongs to" relation (the FK — promo_codes.campaign_id
  // — lives on this table) as a single nested object, not an array. `null` is
  // handled defensively below for an orphaned row, even though the FK is
  // NOT NULL and no delete path exists for campaigns today.
  campaigns: { kind: CampaignKind } | null;
}

export interface CampaignKindStats {
  kind: CampaignKind;
  issued: number;
  sent: number;
  rejected: number;
  expired: number;
  redeemed: number;
}

// The only two kinds apps/orch-a's digest needs to know about — deliberately
// narrower than the DB check constraint (which also allows 'social_code_word'
// and 'manual'), matching CampaignKind in campaign-messages.ts. Always
// reported, even at zero activity or before any campaigns row exists yet for
// a kind, so the digest has a stable, predictable shape from day one.
const CAMPAIGN_KINDS: CampaignKind[] = ["seasonal_nudge", "stalled_link_nudge"];

function emptyStats(kind: CampaignKind): CampaignKindStats {
  return { kind, issued: 0, sent: 0, rejected: 0, expired: 0, redeemed: 0 };
}

/**
 * Pure aggregation, exported for unit testing — pull everything, reduce in
 * JS, same style as apps/crm/src/lib/finance-sync.ts's
 * aggregateFinanceBookings, rather than a raw SQL GROUP BY. Always returns
 * exactly one entry per CAMPAIGN_KINDS entry, in that order. Rows under any
 * other campaign kind, or whose `campaigns` join comes back null, are
 * silently excluded rather than crashing.
 */
export function aggregateCampaignStats(rows: PromoCodeWithCampaignRow[]): CampaignKindStats[] {
  const byKind = new Map<CampaignKind, CampaignKindStats>(
    CAMPAIGN_KINDS.map((kind) => [kind, emptyStats(kind)]),
  );

  for (const row of rows) {
    const kind = row.campaigns?.kind;
    const stats = kind ? byKind.get(kind) : undefined;
    if (!stats) {
      continue;
    }
    stats[row.status] += 1;
  }

  return CAMPAIGN_KINDS.map((kind) => byKind.get(kind) as CampaignKindStats);
}

/**
 * PII-free aggregate campaign-conversion stats for apps/orch-a's digest:
 * counts of promo_codes per (campaign kind, status) ONLY. Never returns
 * guest_contact_id, phone, name, or code — never a single per-guest row —
 * that was a deliberate design decision so Orch-A, the only intended caller,
 * never needs any PII-handling of its own.
 *
 * `redeemed` is currently always 0: no code path sets promo_codes.status to
 * 'redeemed' yet. Real booking-conversion tracking requires a website
 * checkout change and is a separate, still-open gap — not addressed here.
 *
 * Response: `{ campaigns: CampaignKindStats[] }`, always containing both
 * known kinds (seasonal_nudge, stalled_link_nudge) regardless of how much
 * (or how little) data exists for either.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("promo_codes").select("status, campaigns(kind)");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    campaigns: aggregateCampaignStats((data ?? []) as unknown as PromoCodeWithCampaignRow[]),
  });
}
