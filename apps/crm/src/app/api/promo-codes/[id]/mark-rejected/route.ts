import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Marks a promo_codes row as rejected. The intended caller is a later
 * phase's Telegram callback handler, when the owner explicitly declines a
 * drafted follow-up rather than approving it — a distinct terminal state
 * from 'expired' (see
 * supabase/migrations/20260721120000_promo_codes_rejected_status_and_message_text.sql's
 * own comment for why those two must not be conflated).
 *
 * Only a valid transition from status = 'issued'. Same guard as
 * ../mark-sent: if the row isn't currently issued, 409s with
 * `{ error: "Cannot mark rejected from status '<current>'" }`.
 *
 * On success: sets status = 'rejected', returns
 * `{ ok: true, status: "rejected" }`.
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
      { error: `Cannot mark rejected from status '${existing.status}'` },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("promo_codes")
    .update({ status: "rejected" })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "rejected" });
}
