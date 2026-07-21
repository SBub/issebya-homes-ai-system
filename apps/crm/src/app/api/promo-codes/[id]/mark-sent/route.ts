import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Marks a promo_codes row as sent. The intended caller is a later phase's
 * Telegram callback handler, right after it has actually delivered the
 * drafted message_text (e.g. via apps/guest-communication-agent's new
 * POST /api/send) — this route itself never sends anything, it only
 * records that a send already happened.
 *
 * Only a valid transition from status = 'issued'. Guards against double
 * sends: if the owner double-clicks Approve, or the row is already
 * sent/rejected/expired for any other reason, this does NOT silently
 * overwrite — it 409s with `{ error: "Cannot mark sent from status '<current>'" }`
 * so the caller can tell "already handled" apart from a real failure.
 *
 * On success: sets status = 'sent', sent_at = now(); returns
 * `{ ok: true, status: "sent" }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: existing, error: selectError } = await supabase
    .from("promo_codes")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.status !== "issued") {
    return NextResponse.json(
      { error: `Cannot mark sent from status '${existing.status}'` },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("promo_codes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "sent" });
}
