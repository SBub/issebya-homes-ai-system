import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

/**
 * Proxies to apps/guest-communication-agent's new GET /api/conversations,
 * server-side, so GUEST_COMMUNICATION_AGENT_API_KEY never reaches the
 * browser — only CRM's own CRM_API_KEY does, via the dashboard's own
 * API-key field (apps/crm/src/app/page.tsx). Guarded the same way every
 * other CRM route is (requireApiKey / CRM_API_KEY); this is still a
 * CRM-facing endpoint, it just happens to fetch from another app internally.
 *
 * `phone` is passed straight through from the route param — no
 * normalization here, GCA's own route already reconciles both phone forms
 * (apps/guest-communication-agent/src/app/api/conversations/route.ts's own
 * doc comment explains why).
 *
 * Returns GCA's response body and status code as-is. If
 * GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured, or the fetch
 * itself fails (network error, GCA down), returns 502 — unlike GCA's own
 * src/lib/crm.ts (which no-ops for a conversational reply that must not
 * block on an optional enrichment), this route's entire job IS this call, so
 * there is no sensible fallback response.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { phone } = await params;

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
    const res = await fetch(`${baseUrl}/api/conversations?phone=${encodeURIComponent(phone)}`, {
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
