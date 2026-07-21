import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase";

/**
 * Guest-lookup endpoint. Callers (currently apps/guest-communication-agent's
 * load_context node, on every conversational turn) pass a phone number in
 * whatever form they have it — Twilio's `whatsapp:`-prefixed form, or a bare
 * number typed by a human into Notion — and this normalizes it via
 * normalizePhone() before querying, so both forms land on the same row (see
 * ./phone.ts's own doc comment for why that matters).
 *
 * Response shape (deliberately simple, no envelope beyond `found`):
 *   - `{ found: true, last_room, last_stay_checkin, total_stays }` when a
 *     guest_contacts row exists for the normalized phone.
 *   - `{ found: false }` when no row exists.
 *
 * This returns the raw row's data as-is — it does NOT apply the
 * "total_stays <= 0 means no info" interpretation that
 * apps/guest-communication-agent's loadGuestInfo applies on top of this.
 * That's caller-side interpretation logic (specific to how GCA phrases guest
 * context to the LLM), not a fact about what's actually stored — CRM's job
 * here is just to report the truth of the table.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "Missing phone query parameter" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: contact, error } = await supabase
    .from("guest_contacts")
    .select("last_room, last_stay_checkin, total_stays")
    .eq("phone", normalizePhone(phone))
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!contact) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    last_room: contact.last_room,
    last_stay_checkin: contact.last_stay_checkin,
    total_stays: contact.total_stays,
  });
}
