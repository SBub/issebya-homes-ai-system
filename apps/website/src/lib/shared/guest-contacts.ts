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

/**
 * Upserts a guest_contacts row and returns its id, so bookings can link via
 * guest_contact_id instead of duplicating guest identity fields onto the
 * bookings row. Throws on failure — callers decide how critical the link is
 * for their write path.
 *
 * `guest_contacts` has independent UNIQUE constraints on both `phone` and
 * `email` (see 20260821160000_link_bookings_to_guest_contacts.sql, which
 * added the email one during the bookings/guest_contacts backfill). A plain
 * `.upsert(..., { onConflict: "phone" })` only guards the phone constraint —
 * a guest with a pre-existing phone-less row keyed by email (e.g. from that
 * backfill, or simply a past booking under the same email but no phone at
 * the time) collides on guest_contacts_email_key the moment they book again
 * with a real phone number, since Postgres tries the INSERT branch and hits
 * the OTHER unique constraint. Confirmed in production: Sentry issue
 * JAVASCRIPT-NEXTJS-1E, "duplicate key value violates unique constraint
 * guest_contacts_email_key".
 *
 * Fixed by looking the row up by phone OR email first, then updating that
 * row if found, only falling back to INSERT for a genuinely new guest.
 */
export async function upsertGuestContact(params: UpsertGuestContactParams): Promise<string> {
  const supabase = createAdminClient();
  const fields = buildFields(params);

  const { data: existing, error: lookupError } = await supabase
    .from("guest_contacts")
    .select("id, phone, email")
    .or(`phone.eq.${params.phone},email.eq.${params.email}`)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existing) {
    return updateExisting(supabase, existing.id, fields);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("guest_contacts")
    .insert(fields)
    .select("id")
    .single();

  if (!insertError) {
    return inserted.id;
  }

  // Race: another request inserted a matching phone/email between our
  // lookup and this insert. Not a paranoid retry loop — this is a low-
  // traffic two-room B&B, one retry-as-update is enough to cover the
  // realistic window, not a high-concurrency system needing backoff.
  if (insertError.code === UNIQUE_VIOLATION) {
    const { data: retryExisting, error: retryLookupError } = await supabase
      .from("guest_contacts")
      .select("id")
      .or(`phone.eq.${params.phone},email.eq.${params.email}`)
      .limit(1)
      .maybeSingle();

    if (retryLookupError || !retryExisting) {
      throw retryLookupError ?? insertError;
    }

    return updateExisting(supabase, retryExisting.id, fields);
  }

  throw insertError;
}

async function updateExisting(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  fields: ReturnType<typeof buildFields>,
): Promise<string> {
  // Merge, don't blindly overwrite: the incoming call is the guest's
  // current stated phone/email/name, so it wins over whatever's stored —
  // this is the same "guest just told us their info again" case as a
  // returning guest updating their number, not a conflict to resolve
  // between two different guests (that scenario doesn't arise here: the
  // row was found precisely because phone OR email already matched this
  // guest's own identity).
  const { data, error } = await supabase
    .from("guest_contacts")
    .update(fields)
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("guest_contacts update returned no row");
  }

  return data.id;
}
