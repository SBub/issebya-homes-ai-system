import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Proxies to apps/guest-communication-agent's GET /api/conversations,
 * server-side, so GUEST_COMMUNICATION_AGENT_API_KEY never reaches the
 * browser — only CRM's own CRM_API_KEY does, via the dashboard's own
 * API-key field (apps/crm/src/app/page.tsx). Guarded the same way every
 * other CRM route is (requireApiKey / CRM_API_KEY); this is still a
 * CRM-facing endpoint, it just happens to fetch from another app internally.
 *
 * Keyed by guest_contacts.id, not phone directly — Next.js doesn't allow two
 * sibling dynamic route segments at the same path depth to use different
 * parameter names (this route used to be [phone]/conversations, which
 * collided with the new PATCH /api/guest-contacts/[id] at the same level and
 * broke routing entirely). Being id-keyed is also just cleaner: this route
 * looks up the row's phone itself rather than the caller needing to
 * URL-encode a phone number, and it can respond meaningfully when the guest
 * has no phone yet (a real, common case — see the [id] PATCH route's own
 * doc comment) instead of that being the caller's problem.
 *
 * - 404 (`{ error: "Not found" }`) if no guest_contacts row matches [id].
 * - `{ conversations: [] }` (200) if the row exists but has no phone yet —
 *   there's nothing to look up, and this is a normal state, not an error.
 * - Otherwise proxies to GCA and returns its response body/status as-is. If
 *   GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured, or the
 *   fetch itself fails (network error, GCA down), returns 502.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  const supabase = createAdminClient();
  const { data: guest, error: selectError } = await supabase
    .from("guest_contacts")
    .select("phone")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!guest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!guest.phone) {
    return NextResponse.json({ conversations: [] });
  }

  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(
      "[crm] GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY is not set",
    );
    return NextResponse.json(
      { error: "guest-communication-agent is not configured" },
      { status: 502 },
    );
  }

  try {
    const res = await fetch(
      `${baseUrl}/api/conversations?phone=${encodeURIComponent(guest.phone)}`,
      { headers: { "X-API-Key": apiKey } },
    );
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
