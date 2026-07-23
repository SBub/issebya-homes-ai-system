// Single shared phone-normalization helper — used everywhere a phone is
// read, written, or compared, so both sides of any comparison always land
// in the same canonical form regardless of which direction the data came
// from (Twilio's WhatsApp webhook vs. a human editing a row directly in
// Postgres, e.g. via Supabase Studio's Table Editor).
//
// Twilio's `From` field always arrives as "whatsapp:+351920742845" (see
// src/lib/db.ts's loadGuestInfo and apps/guest-communication-agent's
// webhook route). A human editing a phone directly will naturally omit
// that prefix (e.g. "+351920742845"). If guest_contacts.phone ends up in
// one form while lookups pass the other, they never match — silently
// breaking guest identity linkage. This function is the one place that
// reconciles that.
//
// Deliberate limitation: this does NOT attempt full E.164
// validation/reformatting (adding missing country codes, stripping
// dashes/spaces inside the number, etc.) — that's a separate, harder
// problem, out of scope for this pass. A phone typed with different
// spacing/formatting than Twilio's E.164 form still won't match.
export function normalizePhone(raw: string): string {
  return raw
    .trim()
    .replace(/^whatsapp:/i, "")
    .trim();
}
