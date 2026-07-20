import { type NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/telegram/auth";
import { sendDigestNow } from "@/lib/telegram/digest";

/**
 * Whatever real scheduler ends up existing (still an open deployment
 * question, same as check-reminders) should call this once a day. Pulls the
 * pre-rendered digest from apps/orch-a (pure logic, no Telegram awareness —
 * GET /digest) and sends it itself, with `parse_mode: "HTML"` preserved
 * (Orch-A's renderReport formats the digest with `<b>`/`<i>` tags — see
 * apps/orch-a/src/core/models.ts). Same underlying send as the on-demand
 * /digest command (see webhook/route.ts) — this is just the scheduled path.
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const result = await sendDigestNow();
  return NextResponse.json(result);
}
