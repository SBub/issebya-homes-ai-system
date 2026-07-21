export interface PostCampaignDraftInput {
  promoCodeId: string;
  campaignKind: string;
  /** Nullable because guest_contacts.phone is nullable (see
   * supabase/migrations/20260721090350_add_id_and_guest_name_normalized_to_guest_contacts.sql) —
   * in practice a candidate reaching this point already has a phone (both
   * campaign queries require a non-null last_interaction_at, which is only
   * ever set by CRM's own POST /api/guest-contacts/touch, itself only
   * reachable via a phone lookup), but the type stays honest rather than
   * assuming that invariant here too. */
  guestPhone: string | null;
  messageText: string;
}

export interface PostCampaignDraftResult {
  ok: boolean;
  error?: string;
}

/**
 * Best-effort push to apps/telegram-router's POST /api/campaign-drafts,
 * which renders the drafted message as a Telegram Approve/Reject prompt.
 * Mirrors apps/finance's src/lib/finance/guest-contacts.ts's
 * syncGuestContacts resilience shape exactly: by the time this is called
 * the promo_codes row is already committed (see ./campaigns.ts's
 * draftForCandidates), so a missing TELEGRAM_ROUTER_API_URL/
 * TELEGRAM_ROUTER_API_KEY (or any delivery failure) must no-op / return a
 * result object rather than throwing — never roll back the insert, never
 * block the cron's response on this side effect.
 */
export async function postCampaignDraft(
  input: PostCampaignDraftInput,
): Promise<PostCampaignDraftResult> {
  const baseUrl = process.env.TELEGRAM_ROUTER_API_URL;
  const apiKey = process.env.TELEGRAM_ROUTER_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${baseUrl}/api/campaign-drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        promoCodeId: input.promoCodeId,
        campaignKind: input.campaignKind,
        guestPhone: input.guestPhone,
        messageText: input.messageText,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `telegram-router campaign-drafts failed (${res.status}): ${await res.text()}`,
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
