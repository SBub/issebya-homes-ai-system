import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

const GUEST_CONTACT_COLUMNS =
  "id, phone, guest_name, guest_name_normalized, last_room, last_stay_checkin, last_stay_checkout, total_stays, platform, last_stay_guests, funnel_stage, enabled, last_interaction_at, link_sent_at, stage_updated_at, created_at, updated_at";

/**
 * Lists every guest_contacts row, unfiltered and unpaginated — powers the v1
 * CRM dashboard's (apps/crm/src/app/page.tsx) guest table. Deliberately no
 * pagination/filtering/search here: this is a first-look internal preview
 * tool, not production scale — those are an explicit, deferred follow-up
 * (see that page's own doc comment).
 *
 * Unlike GET /api/campaigns/stats (a PII-stripped aggregate meant for an
 * external caller, apps/orch-a's digest), this returns every real
 * guest_contacts column as-is: it's an internal dashboard reading CRM's own
 * table directly, so there's no PII-stripping rationale here.
 *
 * Includes `enabled` (see
 * supabase/migrations/20260724130000_add_enabled_to_guest_contacts.sql and
 * PATCH /api/guest-contacts/[id]'s doc comment) so the dashboard can
 * eventually surface which guests are excluded from every campaign — no
 * such column/toggle exists in this dashboard yet, that's a separate,
 * deferred frontend piece.
 *
 * Response: `{ guests: GuestContact[] }`, ordered oldest-first (created_at
 * ascending) purely for a stable, predictable response shape — the
 * dashboard itself does its own client-side sorting via TanStack Table.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("guest_contacts")
    .select(GUEST_CONTACT_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ guests: data ?? [] });
}
