import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Enable/disable toggle for a single campaigns row — powers the v1 CRM
 * dashboard's (apps/crm/src/app/page.tsx) new "Campaigns" tab. `enabled` is
 * the only field patchable through this endpoint for now: this pass is
 * scoped to viewing and operating on campaign rows that already exist, not
 * editing their targeting criteria/message template/offer fields (a
 * separate, later piece of work) — same "id-keyed, requireApiKey, JSON
 * body" shape as PATCH /api/guest-contacts/[id].
 *
 * Request body: `{ enabled: boolean }`. 400
 * (`{ error: "Missing enabled in request body" }`) when enabled is absent
 * or not a boolean. 404 (`{ error: "Not found" }`) when no campaigns row
 * matches the [id] route param. 500 with the raw message on any other DB
 * error.
 *
 * On success, returns the updated row's `{ id, enabled }`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Missing enabled in request body" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: existing, error: selectError } = await supabase
    .from("campaigns")
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
    .from("campaigns")
    .update({ enabled })
    .eq("id", id)
    .select("id, enabled")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
