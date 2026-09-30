import { addBreadcrumb } from "@sentry/nextjs";
import type { PostgrestError } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/shared/supabase";

interface UpsertGuestContactParams {
  phone: string;
  email: string;
  guestName: string;
  whatsappOptIn: boolean;
  roomType?: string;
  checkIn?: string;
  checkOut?: string;
  funnelStage?: "new" | "informed" | "link_sent" | "booked";
}

const UNIQUE_VIOLATION = "23505";

function buildFields({
  phone,
  email,
  guestName,
  whatsappOptIn,
  roomType,
  checkIn,
  checkOut,
  funnelStage,
}: UpsertGuestContactParams) {
  return {
    phone,
    email,
    guest_name: guestName,
    enabled: whatsappOptIn,
    ...(roomType ? { last_room: roomType } : {}),
    ...(checkIn ? { last_stay_checkin: checkIn } : {}),
    ...(checkOut ? { last_stay_checkout: checkOut } : {}),
    ...(funnelStage
      ? { funnel_stage: funnelStage, stage_updated_at: new Date().toISOString() }
      : {}),
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;
type Fields = ReturnType<typeof buildFields>;
type WriteFields = Fields | Omit<Fields, "phone">;

type Target =
  { kind: "insert"; fields: Fields } | { kind: "update"; id: string; fields: WriteFields };

/**
 * Upserts a guest_contacts row and returns its id, so bookings can link via
 * guest_contact_id instead of duplicating guest identity fields onto the
 * bookings row. Throws on failure — callers decide how critical the link is
 * for their write path.
 *
 * `guest_contacts` has independent UNIQUE constraints on both `phone` and
 * `email` (see 20260821160000_link_bookings_to_guest_contacts.sql, which
 * added the email one during the bookings/guest_contacts backfill). A plain
 * `.upsert(..., { onConflict: "phone" })` only guards the phone constraint,
 * which is what caused Sentry issue JAVASCRIPT-NEXTJS-1E ("duplicate key
 * value violates unique constraint guest_contacts_email_key").
 *
 * A guest can also legitimately be split across two rows: GCA creates
 * phone-keyed rows from WhatsApp, bookings and the backfill create
 * email-keyed ones. So the row is resolved by email first, then by phone,
 * as two exact lookups. When they hit two different rows, the email row is
 * the booking's contact (bookings.guest_contact_id) and is updated without
 * `phone`, since another row owns it. The phone row is never touched, because
 * GCA keys WhatsApp history by phone; a warning with both ids is logged so
 * the owner can merge them by hand in Studio.
 *
 * A unique violation on either write (a concurrent insert, or a lookup gone
 * stale) triggers one re-resolution and one retry. Not a paranoid retry
 * loop — this is a low-traffic two-room B&B, one retry covers the realistic
 * window.
 */
export async function upsertGuestContact(params: UpsertGuestContactParams): Promise<string> {
  const supabase = createAdminClient();
  const fields = buildFields(params);

  let result = await write(supabase, await resolveTarget(supabase, params, fields));

  if (result.error?.code === UNIQUE_VIOLATION) {
    result = await write(supabase, await resolveTarget(supabase, params, fields));
  }

  if (result.error) {
    throw result.error;
  }

  if (!result.id) {
    throw new Error("guest_contacts write returned no row");
  }

  return result.id;
}

async function findByEmail(supabase: AdminClient, email: string) {
  const { data, error } = await supabase
    .from("guest_contacts")
    .select("id, phone, email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findByPhone(supabase: AdminClient, phone: string) {
  const { data, error } = await supabase
    .from("guest_contacts")
    .select("id, phone, email")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function resolveTarget(
  supabase: AdminClient,
  params: UpsertGuestContactParams,
  fields: Fields,
): Promise<Target> {
  // Sequential on purpose: email first, then phone.
  const emailRow = await findByEmail(supabase, params.email);
  const phoneRow = await findByPhone(supabase, params.phone);

  if (emailRow && phoneRow && emailRow.id !== phoneRow.id) {
    const emailRowId = emailRow.id;
    const phoneRowId = phoneRow.id;
    // Ids only: no phone, email or name in logs.
    console.warn(
      "[guest-contacts] phone and email belong to different rows; linked to email row, phone left on its own row",
      { emailRowId, phoneRowId },
    );
    addBreadcrumb({
      category: "guest_contacts",
      level: "warning",
      message: "split guest contact",
      data: { emailRowId, phoneRowId },
    });

    const { phone: _phone, ...withoutPhone } = fields;
    return { kind: "update", id: emailRowId, fields: withoutPhone };
  }

  // Same row, or only one of the keys is taken: the other key is free, so
  // the incoming phone/email/name (the guest's current stated details) is
  // written in full onto that row.
  const existing = emailRow ?? phoneRow;
  if (existing) {
    return { kind: "update", id: existing.id, fields };
  }

  return { kind: "insert", fields };
}

async function write(
  supabase: AdminClient,
  target: Target,
): Promise<{ id?: string; error?: PostgrestError }> {
  const query =
    target.kind === "update"
      ? supabase.from("guest_contacts").update(target.fields).eq("id", target.id)
      : supabase.from("guest_contacts").insert(target.fields);

  const { data, error } = await query.select("id").single();

  if (error) {
    return { error };
  }

  return { id: data?.id };
}
