import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Read endpoint for the CRM dashboard's "Escalations" tab, proxied through
 * CRM's own server-side route. Guarded by requireApiKey.
 *
 * Lists every row, unfiltered and unpaginated, ordered newest-first (a
 * browsable incident log). resolved_at/answer are set once a missing_info
 * escalation is resolved; they stay null forever for the other two
 * categories, which have no resolution flow.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("escalations")
    .select(
      "id, conversation_id, phone_number, reason, reason_category, created_at, resolved_at, answer",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ escalations: data ?? [] });
}
