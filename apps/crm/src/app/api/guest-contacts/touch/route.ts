import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase";

type FunnelStage = "new" | "informed" | "link_sent" | "booked";
type StageHint = "informed" | "link_sent" | "booked";

// Fixed forward-only ordering — see this route's own doc comment below for
// why a stageHint can only ever move a row forward through this ranking,
// never back.
const FUNNEL_STAGE_RANK: Record<FunnelStage, number> = {
  new: 0,
  informed: 1,
  link_sent: 2,
  booked: 3,
};

function isStageHint(value: unknown): value is StageHint {
  return value === "informed" || value === "link_sent" || value === "booked";
}

/**
 * Guest-touch endpoint. apps/guest-communication-agent calls this once per
 * turn, after its graph has already replied, to record that a guest
 * interacted (last_interaction_at) and, when the turn's tool calls imply
 * progress toward booking, to advance guest_contacts.funnel_stage.
 *
 * Request body: `{ phone: string, stageHint?: "informed" | "link_sent" | "booked" }`.
 * `stageHint` is optional — a turn where the guest just chatted without
 * triggering a pricing/availability/property-info/booking-link tool still
 * calls this with no stageHint, purely to bump last_interaction_at.
 *
 * Logic:
 *   - Normalize the phone, then look up the guest_contacts row by phone.
 *     If none exists, `{ updated: false }` — this endpoint only ever
 *     updates an existing row, never creates one (POST .../register is what
 *     creates rows). In normal operation register always runs first, but
 *     this does not assume that as a hard invariant — a missing row just
 *     means there's nothing to touch yet.
 *   - Always set last_interaction_at = now() on the found row.
 *   - If stageHint is present, compare its rank (FUNNEL_STAGE_RANK) against
 *     the row's CURRENT funnel_stage. Only move forward: if
 *     rank(stageHint) > rank(current), set funnel_stage = stageHint and
 *     stage_updated_at = now(). Never downgrade — e.g. a guest at
 *     link_sent who later asks another pricing question (stageHint:
 *     "informed") stays at link_sent. If the new stage is specifically
 *     link_sent, also set link_sent_at = now().
 *   - Returns `{ updated: true, funnel_stage }` where funnel_stage is the
 *     row's resulting stage after this call (i.e. the upgraded stage if one
 *     happened, otherwise whatever it already was).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "Missing phone in request body" }, { status: 400 });
  }

  const stageHintRaw = body?.stageHint;
  const stageHint = isStageHint(stageHintRaw) ? stageHintRaw : undefined;

  const normalized = normalizePhone(phone);
  const supabase = createAdminClient();

  const { data: existing, error: selectError } = await supabase
    .from("guest_contacts")
    .select("id, funnel_stage")
    .eq("phone", normalized)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ updated: false });
  }

  const now = new Date().toISOString();
  const currentStage = existing.funnel_stage as FunnelStage;
  let resultingStage = currentStage;

  const update: Record<string, unknown> = { last_interaction_at: now };

  if (stageHint && FUNNEL_STAGE_RANK[stageHint] > FUNNEL_STAGE_RANK[currentStage]) {
    update.funnel_stage = stageHint;
    update.stage_updated_at = now;
    if (stageHint === "link_sent") {
      update.link_sent_at = now;
    }
    resultingStage = stageHint;
  }

  const { error: updateError } = await supabase
    .from("guest_contacts")
    .update(update)
    .eq("id", existing.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ updated: true, funnel_stage: resultingStage });
}
