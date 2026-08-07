import { z } from "zod";

const promoCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.enum(["issued", "sent", "redeemed", "expired", "rejected"]),
  message_text: z.string(),
  campaign_id: z.string(),
  guest_contact_id: z.string().nullable(),
  guest_phone: z.string().nullable(),
});

export type PromoCode = z.infer<typeof promoCodeSchema>;

function baseUrl(): string {
  const url = process.env.CRM_API_URL;
  if (!url) {
    throw new Error("CRM_API_URL is not configured");
  }
  return url;
}

function apiKey(): string {
  const key = process.env.CRM_API_KEY;
  if (!key) {
    throw new Error("CRM_API_KEY is not configured");
  }
  return key;
}

/**
 * Calls CRM's GET /api/promo-codes/:id — the nudge_approve/nudge_reject
 * callback handling in ../../app/api/telegram/webhook/route.ts's
 * handleCallbackQuery calls this first to decide whether the row is still
 * `issued` (i.e. not already handled by a double-tap or a previous run).
 *
 * This sits directly in that request-handling path, which needs to branch
 * on the result (issued vs already-handled vs a real failure) — unlike
 * apps/finance's fire-and-forget syncGuestContacts, this throws on any
 * failure (missing config, non-2xx, unparseable body) rather than
 * swallowing into null, matching this router's existing social.ts
 * client convention for calls that need to know success vs failure to
 * decide what to do next.
 */
export async function getPromoCode(promoCodeId: string): Promise<PromoCode> {
  const res = await fetch(`${baseUrl()}/api/promo-codes/${encodeURIComponent(promoCodeId)}`, {
    headers: { "X-API-Key": apiKey() },
  });
  if (!res.ok) {
    throw new Error(
      `CRM GET /api/promo-codes/${promoCodeId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return promoCodeSchema.parse(await res.json());
}

/**
 * Calls CRM's POST /api/promo-codes/:id/mark-sent, right after a successful
 * GCA send. Only ever called once handleCallbackQuery has already confirmed
 * (via getPromoCode) that the row is `issued` and the send succeeded, so a
 * plain throw-on-failure is enough here — the outer try/catch around the
 * whole nudge_approve branch (mirroring the existing done: case's
 * try/catch/console.error pattern) is what turns a failure here into a
 * logged error + "try again" toast.
 */
export async function markPromoCodeSent(promoCodeId: string): Promise<void> {
  const res = await fetch(
    `${baseUrl()}/api/promo-codes/${encodeURIComponent(promoCodeId)}/mark-sent`,
    { method: "POST", headers: { "X-API-Key": apiKey() } },
  );
  if (!res.ok) {
    throw new Error(
      `CRM mark-sent for promo code ${promoCodeId} failed (${res.status}): ${await res.text()}`,
    );
  }
}

export type MarkPromoCodeRejectedResult =
  | { ok: true }
  | { ok: false; alreadyHandled: boolean; error?: string };

/**
 * Calls CRM's POST /api/promo-codes/:id/mark-rejected directly — unlike the
 * approve flow, nudge_reject doesn't call getPromoCode first, so a 409
 * (already handled — e.g. a double-tap race) can only be detected from this
 * call's own response. Returns a discriminated result rather than throwing
 * so handleCallbackQuery can tell "already handled" apart from a real
 * failure — the same "surface enough detail to branch on" requirement as
 * getPromoCode above, just shaped as a result object here since 409 isn't
 * an exceptional case, it's an expected outcome this caller must branch on.
 */
export async function markPromoCodeRejected(
  promoCodeId: string,
): Promise<MarkPromoCodeRejectedResult> {
  const res = await fetch(
    `${baseUrl()}/api/promo-codes/${encodeURIComponent(promoCodeId)}/mark-rejected`,
    { method: "POST", headers: { "X-API-Key": apiKey() } },
  );
  if (res.status === 409) {
    return { ok: false, alreadyHandled: true };
  }
  if (!res.ok) {
    return {
      ok: false,
      alreadyHandled: false,
      error: `CRM mark-rejected for promo code ${promoCodeId} failed (${res.status}): ${await res.text()}`,
    };
  }
  return { ok: true };
}
