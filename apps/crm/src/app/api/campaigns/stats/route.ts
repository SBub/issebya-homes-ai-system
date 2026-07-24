import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

type PromoCodeStatus = "issued" | "sent" | "redeemed" | "expired" | "rejected";

// This digest's own fixed allowlist of kinds to report — NOT derived from
// any DB constraint anymore. Before
// supabase/migrations/20260724110000_campaigns_data_driven_targeting.sql,
// campaigns.kind was a 4-value check constraint and this type was described
// as "narrower" than it; now kind is unrestricted `text` (any campaign can be
// named anything), so there's no DB-level set to be narrower than. This
// array is simply "the two kinds Orch-A's digest currently knows how to
// show" — always reported, even at zero activity or before any campaigns
// row exists for a kind, so the digest has a stable, predictable shape from
// day one. A future campaign kind (e.g. a win-back or winter-program
// campaign) won't appear here until this list is deliberately extended.
type DigestCampaignKind = "seasonal_nudge" | "stalled_link_nudge";

interface PromoCodeWithCampaignRow {
  status: PromoCodeStatus;
  // supabase-js embeds a "belongs to" relation (the FK — promo_codes.campaign_id
  // — lives on this table) as a single nested object, not an array. `null` is
  // handled defensively below for an orphaned row, even though the FK is
  // NOT NULL and no delete path exists for campaigns today.
  campaigns: { kind: DigestCampaignKind } | null;
}

export interface CampaignKindStats {
  kind: DigestCampaignKind;
  issued: number;
  sent: number;
  rejected: number;
  expired: number;
  redeemed: number;
}

const CAMPAIGN_KINDS: DigestCampaignKind[] = ["seasonal_nudge", "stalled_link_nudge"];

function emptyStats(kind: DigestCampaignKind): CampaignKindStats {
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
  const byKind = new Map<DigestCampaignKind, CampaignKindStats>(
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
