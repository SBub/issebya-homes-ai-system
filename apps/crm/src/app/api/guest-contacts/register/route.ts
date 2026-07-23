import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase";

/**
 * Guest-registration endpoint. apps/guest-communication-agent calls this the
 * moment a brand-new whatsapp_conversation is created (see its webhook
 * route's use of getOrCreateActiveConversation's `isNew` flag) so a
 * guest_contacts row exists from the very first inbound message, not only
 * once apps/finance's CSV import eventually surfaces them.
 *
 * Request body: `{ phone: string }` — deliberately NO name field. A
 * first-time WhatsApp inquiry has no reliable guest name: Twilio's optional
 * `ProfileName` param is not guaranteed, and fuzzy-matching it against the
 * finance-derived `guest_name_normalized` column risks silently merging two
 * different real people into one contact. That matching problem is out of
 * scope here — this endpoint only ever creates phone-keyed stub rows and is
 * entirely decoupled from the finance name-matching path in
 * ./../../../lib/finance-sync.ts.
 *
 * Logic: normalize the phone, then look for an existing guest_contacts row.
 *   - If one already exists (a real past-stay row, or an already-registered
 *     stub), no-op — `{ created: false }`. Never overwrite it.
 *   - If none exists, insert a new row with ONLY `phone` set — every other
 *     column (guest_name, guest_name_normalized, last_room,
 *     last_stay_checkin, last_stay_checkout) is left at its schema default
 *     (null, or 0 for total_stays) — `{ created: true }`.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "Missing phone in request body" }, { status: 400 });
  }

  const normalized = normalizePhone(phone);
  const supabase = createAdminClient();

  const { data: existing, error: selectError } = await supabase
    .from("guest_contacts")
    .select("phone")
    .eq("phone", normalized)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ created: false });
  }

  const { error: insertError } = await supabase
    .from("guest_contacts")
    .insert({ phone: normalized });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ created: true });
}
