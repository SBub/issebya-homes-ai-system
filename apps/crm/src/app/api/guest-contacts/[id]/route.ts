import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase";

/**
 * Guest phone-edit + campaign-eligibility endpoint. Powers the v1 CRM
 * dashboard's (apps/crm/src/app/page.tsx) inline-editable phone cell —
 * phone and enabled are the only fields editable through this route so far
 * (see that page's own doc comment for why name/funnel_stage/etc. editing
 * stays out of scope for this pass). Phone-editing is also the only way to
 * attach a phone number to a guest_contacts row created without one (see
 * supabase/migrations/20260721090350_..._to_guest_contacts.sql — rows
 * synced from apps/finance's booking history have no phone at all until a
 * human recognizes the guest and fills it in here).
 *
 * Request body: `{ phone?: string, enabled?: boolean }` — each optional, but
 * at least one must be present (400, `{ error: "Must provide phone and/or
 * enabled" }`, if neither is). The update object is built dynamically from
 * whichever field(s) were actually provided, so patching one never touches
 * the other — e.g. `{ enabled: false }` alone leaves phone untouched.
 *
 * phone, when provided, must be a non-empty string and is normalized via
 * normalizePhone before writing, same as every other phone write path in
 * this app (register/touch routes). enabled, when provided, must be an
 * actual boolean (400 otherwise) — see
 * supabase/migrations/20260724130000_add_enabled_to_guest_contacts.sql for
 * what it means: whether this guest should ever be contacted by a campaign
 * at all. Setting it to false is a blanket exclusion respected by
 * apps/crm/src/lib/campaigns.ts's getCampaignCandidates for every campaign,
 * not a per-campaign toggle — the motivating case (the user's own words) is
 * an owner marking a guest who "wasn't happy with their stay" so they're
 * never bothered by another campaign again.
 *
 * 404 (`{ error: "Not found" }`) when no guest_contacts row matches the [id]
 * route param.
 *
 * guest_contacts.phone has a UNIQUE constraint (see
 * supabase/migrations/20260721090350_add_id_and_guest_name_normalized_to_guest_contacts.sql).
 * If a phone update collides with another row's phone, Postgres/Supabase-js
 * surfaces this as error code '23505' — detected specifically and returned
 * as 409 (`{ error: "This phone number is already used by another guest" }`)
 * so the dashboard can show a targeted inline error instead of a generic
 * failure. Any other DB error still falls through to 500 with the raw
 * message, matching this app's convention elsewhere (register/touch/
 * promo-codes routes).
 *
 * On success, returns the updated row's `{ id, phone, enabled }` — the
 * frontend trusts this over its own input since normalizePhone may change
 * what's actually stored for phone.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  const enabled = body?.enabled;

  const hasPhone = phone !== undefined;
  const hasEnabled = enabled !== undefined;

  if (!hasPhone && !hasEnabled) {
    return NextResponse.json({ error: "Must provide phone and/or enabled" }, { status: 400 });
  }

  if (hasPhone && (!phone || typeof phone !== "string")) {
    return NextResponse.json({ error: "Missing phone in request body" }, { status: 400 });
  }

  if (hasEnabled && typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const update: { phone?: string; enabled?: boolean } = {};
  if (hasPhone) {
    update.phone = normalizePhone(phone);
  }
  if (hasEnabled) {
    update.enabled = enabled;
  }

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
    .update(update)
    .eq("id", id)
    .select("id, phone, enabled")
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
