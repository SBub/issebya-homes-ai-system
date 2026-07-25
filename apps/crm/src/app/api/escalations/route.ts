import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

/**
 * Proxies to apps/guest-communication-agent's GET /api/escalations,
 * server-side, so GUEST_COMMUNICATION_AGENT_API_KEY never reaches the
 * browser — only CRM's own CRM_API_KEY does, via the dashboard's own
 * API-key field (apps/crm/src/app/page.tsx). Guarded the same way every
 * other CRM route is (requireApiKey / CRM_API_KEY), same pattern as
 * apps/crm/src/app/api/guest-contacts/[id]/conversations/route.ts — except
 * there's no id-to-phone lookup step here, since escalations aren't keyed by
 * a CRM-owned row at all; this simply forwards the request straight through.
 *
 * Unlike the conversations proxy, this route takes no parameters and does no
 * Supabase query of its own — escalations is a GCA-owned table this app has
 * no other reason to touch, so there's nothing to look up before proxying.
 *
 * Passes GCA's response body/status through as-is on a normal response. If
 * GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured, or the fetch
 * itself fails (network error, GCA down), returns 502.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
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
    const res = await fetch(`${baseUrl}/api/escalations`, {
      headers: { "X-API-Key": apiKey },
    });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
