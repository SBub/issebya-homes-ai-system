import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase";

/**
 * Guest phone-edit endpoint. Powers the v1 CRM dashboard's
 * (apps/crm/src/app/page.tsx) inline-editable phone cell — phone is the only
 * field editable there so far (see that page's own doc comment for why name/
 * funnel_stage/etc. editing stays out of scope for this pass). Also the only
 * way to attach a phone number to a guest_contacts row created without one
 * (see supabase/migrations/20260721090350_..._to_guest_contacts.sql — rows
 * synced from apps/finance's booking history have no phone at all until a
 * human recognizes the guest and fills it in here).
 *
 * Request body: `{ phone: string }`. Normalized via normalizePhone before
 * writing, same as every other phone write path in this app (register/touch
 * routes).
 *
 * 404 (`{ error: "Not found" }`) when no guest_contacts row matches the [id]
 * route param.
 *
 * guest_contacts.phone has a UNIQUE constraint (see
 * supabase/migrations/20260721090350_add_id_and_guest_name_normalized_to_guest_contacts.sql).
 * If the update collides with another row's phone, Postgres/Supabase-js
 * surfaces this as error code '23505' — detected specifically and returned
 * as 409 (`{ error: "This phone number is already used by another guest" }`)
 * so the dashboard can show a targeted inline error instead of a generic
 * failure. Any other DB error still falls through to 500 with the raw
 * message, matching this app's convention elsewhere (register/touch/
 * promo-codes routes).
 *
 * On success, returns the updated row's `{ id, phone }` — the frontend
 * trusts this over its own input since normalizePhone may change what's
 * actually stored.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "Missing phone in request body" }, { status: 400 });
  }

  const normalized = normalizePhone(phone);
  const supabase = createAdminClient();

  const { data: existing, error: selectError } = await supabase
    .from("guest_contacts")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("guest_contacts")
    .update({ phone: normalized })
    .eq("id", id)
    .select("id, phone")
    .single();

  if (updateError) {
    if (updateError.code === "23505") {
      return NextResponse.json(
        { error: "This phone number is already used by another guest" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
