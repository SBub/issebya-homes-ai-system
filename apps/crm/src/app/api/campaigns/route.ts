import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Lists every campaigns row, unfiltered and unpaginated — powers the v1 CRM
 * dashboard's (apps/crm/src/app/page.tsx) new "Campaigns" tab, a
 * list + enable/disable + run-now view over campaign rows that already
 * exist (seeded via migration, not created through this UI — that's a
 * separate, later piece of work).
 *
 * Same "select *, order by created_at ascending" convention as
 * GET /api/guest-contacts. Response: `{ campaigns: Campaign[] }`.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data ?? [] });
}
