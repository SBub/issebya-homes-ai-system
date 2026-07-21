import { z } from "zod";

export const campaignStatsSchema = z.object({
  kind: z.enum(["seasonal_nudge", "stalled_link_nudge"]),
  issued: z.number().int(),
  sent: z.number().int(),
  rejected: z.number().int(),
  expired: z.number().int(),
  redeemed: z.number().int(),
});

export type CampaignStats = z.infer<typeof campaignStatsSchema>;

interface CampaignStatsApiResponse {
  campaigns: unknown[];
}

/**
 * Calls CRM's GET /api/campaigns/stats for aggregate promo-code counts per
 * campaign kind. PII-free by construction (see that route's own doc
 * comment) — never guest_contact_id, phone, name, or code, only counts.
 *
 * Same failure shape as fetchAvailability/fetchFinance: this runs inside
 * the Analyze step, which has no per-source resilience yet, so a missing
 * CRM_API_URL/CRM_API_KEY, a failed fetch, or a non-2xx response all throw
 * rather than degrading gracefully — this deliberately does NOT follow
 * apps/guest-communication-agent's src/lib/crm.ts's "never throw, return
 * null" shape, since that shape exists for a different reason (an
 * in-band conversational path that must survive a CRM outage), not one that
 * applies to this scheduled pipeline.
 */
export async function fetchCampaignStats(): Promise<CampaignStats[]> {
  const baseUrl = process.env.CRM_API_URL;
  const apiKey = process.env.CRM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("fetchCampaignStats: CRM_API_URL/CRM_API_KEY is not configured");
  }

  const response = await fetch(`${baseUrl}/api/campaigns/stats`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`campaign stats fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as CampaignStatsApiResponse;
  return data.campaigns.map((c) => campaignStatsSchema.parse(c));
}
