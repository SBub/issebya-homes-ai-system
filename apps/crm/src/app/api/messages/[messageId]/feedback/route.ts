import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

/**
 * Proxies to apps/guest-communication-agent's POST
 * /api/messages/[messageId]/feedback, server-side, so
 * GUEST_COMMUNICATION_AGENT_API_KEY never reaches the browser — only CRM's
 * own CRM_API_KEY does, via the dashboard's own API-key field
 * (apps/crm/src/app/page.tsx). Same "keep GCA's own API key entirely
 * server-side" pattern as
 * apps/crm/src/app/api/guest-contacts/[id]/conversations/route.ts, which
 * this mirrors almost exactly — the only real difference is this route has
 * nothing of its own to look up first (no guest_contacts row involved, just
 * a straight pass-through keyed by messageId), so there's no 404/200-empty
 * branch before the proxy call.
 *
 * Request body `{ score: 0 | 1 }` is forwarded to GCA as-is; GCA is the one
 * that actually validates it (400 on missing/invalid score, 404 if
 * messageId doesn't exist, 400 if the message has no recorded
 * langsmith_run_id, 500 on a LangSmith API failure). This route just relays
 * GCA's status/body back to the caller unchanged on a real response.
 *
 * If GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured, or the
 * fetch itself fails (network error, GCA down), returns 502 — same as the
 * conversations proxy.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { messageId } = await params;

  const body = await request.json().catch(() => null);

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
    const res = await fetch(`${baseUrl}/api/messages/${encodeURIComponent(messageId)}/feedback`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const responseBody = await res.json();
    return NextResponse.json(responseBody, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
