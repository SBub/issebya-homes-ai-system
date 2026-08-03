import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * New read endpoint for the v1 CRM dashboard (apps/crm/src/app/page.tsx)'s
 * new "Escalations" tab — the only caller today is CRM's own proxy route,
 * apps/crm/src/app/api/escalations/route.ts, which keeps this route's API
 * key entirely server-side. Guarded by the existing requireApiKey (X-API-Key
 * against GUEST_COMMUNICATION_AGENT_API_KEY), same as GET /api/conversations
 * and POST /api/send.
 *
 * Lists every escalations row, unfiltered and unpaginated — same "internal
 * preview tool, not production scale" convention as GET /api/guest-contacts
 * and GET /api/campaigns (both apps/crm). Ordered by created_at DESCENDING
 * (most recent first), unlike those two routes' ascending convention: this
 * is a browsable incident log, and an owner checking in on escalations cares
 * about what just happened, not the oldest backlog entry — recency-first
 * reads better for that use case than a stable-since-creation ordering.
 *
 * Response: `{ escalations: [{ id, conversation_id, phone_number, reason,
 * reason_category, created_at, resolved_at, answer }] }`. reason_category is
 * null for the one pre-existing row that predates that column (see
 * supabase/migrations/20260725100000_add_reason_category_to_escalations.sql)
 * and a real enum value for every escalation created since — see
 * @/agent/tools/escalation-shared.ts's performEscalation (shared by the
 * wants_human/complaint/missing_info tools) for where it's populated.
 * resolved_at/answer are set once a missing_info escalation has
 * been resolved (see POST /api/escalations/[id]/resolve) — both are null
 * until then, and stay null forever for the other two categories, which
 * have no resolution flow.
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
