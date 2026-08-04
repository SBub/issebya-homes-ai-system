// Strips Twilio's "whatsapp:" prefix from a phone number, case-insensitive,
// trimmed. This is GCA's one ingress-boundary normalization point (see
// src/app/api/webhook/whatsapp/route.ts) — everything downstream of the
// webhook (the agent, its tools, memory, CRM calls) receives and forwards
// the already-normalized value and never has to know the prefix exists.
//
// Mirrors apps/crm/src/lib/phone.ts's normalizePhone in name/shape (same
// concept, same limitation) — duplicated locally rather than imported,
// since apps/crm isn't importable across the app boundary.
//
// Deliberate limitation: this does NOT attempt full E.164
// validation/reformatting — just prefix-stripping. Out of scope here, same
// as in CRM's version.
export function normalizePhone(raw: string): string {
  return raw
    .trim()
    .replace(/^whatsapp:/i, "")
    .trim();
}
