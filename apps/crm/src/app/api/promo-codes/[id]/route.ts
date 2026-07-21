import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Promo-code read endpoint. Phase 2 of campaign-conversion-tracking (see
 * supabase/migrations/20260721120000_promo_codes_rejected_status_and_message_text.sql)
 * — the intended caller is a later phase's Telegram callback handler, which
 * needs the drafted message_text and the guest's phone number to actually
 * send it once the owner approves. Not wired to anything yet; this route
 * alone has no side effects.
 *
 * Response shape: `{ id, code, status, message_text, campaign_id,
 * guest_contact_id, guest_phone }`. `guest_phone` is not a promo_codes
 * column — it's looked up with a second query against guest_contacts by
 * guest_contact_id, since promo_codes.guest_contact_id is nullable (a
 * social code-word campaign issues codes before any guest is attached — see
 * the Phase 1 migration's own comment) and a phone lookup requires its own
 * null-check rather than assuming a join always resolves.
 *
 * 404 (`{ error: "Not found" }`) when no promo_codes row matches id.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: promoCode, error } = await supabase
    .from("promo_codes")
    .select("id, code, status, message_text, campaign_id, guest_contact_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!promoCode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let guestPhone: string | null = null;
  if (promoCode.guest_contact_id) {
    const { data: guestContact, error: guestError } = await supabase
      .from("guest_contacts")
      .select("phone")
      .eq("id", promoCode.guest_contact_id)
      .maybeSingle();

    if (guestError) {
      return NextResponse.json({ error: guestError.message }, { status: 500 });
    }

    guestPhone = guestContact?.phone ?? null;
  }

  return NextResponse.json({
    id: promoCode.id,
    code: promoCode.code,
    status: promoCode.status,
    message_text: promoCode.message_text,
    campaign_id: promoCode.campaign_id,
    guest_contact_id: promoCode.guest_contact_id,
    guest_phone: guestPhone,
  });
}
