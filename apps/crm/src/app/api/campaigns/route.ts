import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

/**
 * Lists every campaigns row, unfiltered and unpaginated — powers the v1 CRM
 * dashboard's (apps/crm/src/app/page.tsx) new "Campaigns" tab, a
 * list + enable/disable + run-now view over campaign rows that already
 * exist (seeded via migration, not created through this UI — that's a
 * separate, later piece of work).
 *
 * Same "select *, order by created_at ascending" convention as
 * GET /api/guest-contacts. Response: `{ campaigns: Campaign[] }`.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data ?? [] });
}

/**
 * Creates a new campaigns row — the piece GET above's own doc comment
 * flagged as deliberately deferred ("not created through this UI ... a
 * separate, later piece of work"), now built. This is the API + DB layer
 * only: the actual creation form/dialog is a separate frontend pass, not
 * part of this route.
 *
 * Required (400, `{ error: "<field> is required" }`, if missing or an empty
 * string): `name`, `kind`, `message_template` — the same three columns that
 * are `not null` (kind/name) or `not null default ''` but meaningless empty
 * (message_template) at the schema layer; see
 * supabase/migrations/20260721103000_add_funnel_stage_and_campaign_tables.sql
 * and 20260724110000_campaigns_data_driven_targeting.sql. A campaign with no
 * message_template can never actually draft anything
 * (renderCampaignMessage would just render empty text), so it's required
 * here even though the column itself allows ''.
 *
 * Optional, mirroring campaigns' own nullable targeting/offer columns (see
 * lib/campaigns.ts's Campaign doc comment for what each one means):
 * `target_funnel_stage` (string), `min_idle_days` (number),
 * `target_stay_before` (date string, e.g. "2026-06-01"), `min_total_stays`
 * (number), `discount_percent` (number), `offer_description` (string,
 * defaults to `''` — the column's own default — when omitted), `is_recurring`
 * (boolean, defaults to `false` when omitted). Each, when present, is
 * type-checked (string/number/boolean as appropriate) and rejected with 400
 * if malformed — a wrong-typed optional field is a caller bug, not silently
 * coerced or dropped.
 *
 * `enabled` is deliberately NOT accepted in the body — every campaign,
 * however created, starts enabled via the column's own `default true` (see
 * 20260724110000_campaigns_data_driven_targeting.sql), same as both
 * migration-seeded campaigns and the two seeded by
 * 20260724120000_seed_returning_guest_and_winter_campaigns.sql. Toggling it
 * off is exclusively PATCH /api/campaigns/[id]'s job, post-creation.
 *
 * On success, inserts the row and returns it as-is (every real column,
 * matching what GET above returns for a row) with 201. 500 with the raw
 * message on any other DB error.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);

  const name = body?.name;
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const kind = body?.kind;
  if (typeof kind !== "string" || kind.trim() === "") {
    return NextResponse.json({ error: "kind is required" }, { status: 400 });
  }

  const messageTemplate = body?.message_template;
  if (typeof messageTemplate !== "string" || messageTemplate.trim() === "") {
    return NextResponse.json({ error: "message_template is required" }, { status: 400 });
  }

  const insert: Record<string, unknown> = { name, kind, message_template: messageTemplate };

  for (const field of ["target_funnel_stage", "offer_description"] as const) {
    const value = body?.[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
    }
    insert[field] = value;
  }

  for (const field of ["min_idle_days", "min_total_stays", "discount_percent"] as const) {
    const value = body?.[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "number" || Number.isNaN(value)) {
      return NextResponse.json({ error: `${field} must be a number` }, { status: 400 });
    }
    insert[field] = value;
  }

  const targetStayBefore = body?.target_stay_before;
  if (targetStayBefore !== undefined && targetStayBefore !== null) {
    if (typeof targetStayBefore !== "string") {
      return NextResponse.json({ error: "target_stay_before must be a string" }, { status: 400 });
    }
    insert.target_stay_before = targetStayBefore;
  }

  const isRecurring = body?.is_recurring;
  if (isRecurring !== undefined && isRecurring !== null) {
    if (typeof isRecurring !== "boolean") {
      return NextResponse.json({ error: "is_recurring must be a boolean" }, { status: 400 });
    }
    insert.is_recurring = isRecurring;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("campaigns").insert(insert).select("*").single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
